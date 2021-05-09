import { Logger } from '@azure/functions'
import * as acme from 'acme-client';
import { AzureIdentityCredentialAdapter } from '@azure/ms-rest-js';
import { TokenCredential } from '@azure/identity';
import { CertificateClient, CertificatePolicy, ArrayOneOrMore } from '@azure/keyvault-certificates';
import { DnsManagementClient } from '@azure/arm-dns';
import { AzureOptions, CertKeyOptions, CertRequest } from './certRequest';

// Convert the ACME authorization detail to validation domain
// that's compatible with Azure DNS format.
const authzToRelativeDomain = (dnsZone: string, authz: acme.Authorization): string => {
    const relativeDomain = authz.identifier.value.replace(`.${dnsZone}`, '');
    return `_acme-challenge.${relativeDomain}`;
};

// Create a record set in Azure DNS for the given ACME DNS challenge.
const azureDnsCreateChallenge = async (
    logger: Logger,
    opts: AzureOptions,
    dnsClient: DnsManagementClient,
    authz: acme.Authorization,
    keyAuthorization: string,
): Promise<void> => {
    const relativeDomain = authzToRelativeDomain(opts.dnsZone, authz);
    logger.verbose(`Creating TXT record: "${relativeDomain}" = "${keyAuthorization}"`);
    await dnsClient.recordSets.createOrUpdate(
        opts.dnsZoneResourceGroup, opts.dnsZone,
        relativeDomain, 'TXT',
        {
            tTL: 30,
            txtRecords: [{
                value: [keyAuthorization],
            }]
        }
    );
};

// Delete the ACME DNS challenge from Azure DNS
const azureDnsRemoveChallenge = async (
    logger: Logger,
    opts: AzureOptions,
    dnsClient: DnsManagementClient,
    authz: acme.Authorization,
): Promise<void> => {
    const relativeDomain = authzToRelativeDomain(opts.dnsZone, authz);
    logger.verbose(`Deleting TXT record "${relativeDomain}"`);
    await dnsClient.recordSets.deleteMethod(
        opts.dnsZoneResourceGroup, opts.dnsZone,
        relativeDomain, 'TXT'
    );
};

// Order a certificate using the ACME protocol
const orderCertificate = async (
    dnsClient: DnsManagementClient,
    logger: Logger,
    certRequest: CertRequest,
    csr: string
): Promise<string> => {
    const client = new acme.Client({
        directoryUrl: certRequest.acme.acmeDirectoryUrl,
        accountKey: await acme.forge.createPrivateKey(),
    });

    logger.verbose('Register account');
    await client.createAccount({
        termsOfServiceAgreed: true,
        contact: [`mailto:${certRequest.acme.contactEmail}`],
    });

    logger.verbose('Place new order');
    const order = await client.createOrder({
        identifiers: [
            certRequest.certKey.commonName,
            ...(certRequest.certKey.alternativeNames || [])
        ].map(
            (domain) => ({ type: 'dns', value: domain })
        )
    });

    logger.verbose('Get authorizations for order');
    const authorizations = await client.getAuthorizations(order);
    await Promise.all(authorizations.map(async (authz) => {
        // Only the DNS challenge is supported
        const challenge = authz.challenges.find(
            (challenge) => challenge.type === 'dns-01'
        );
        if (!challenge) {
            throw new Error(`No DNS challenge found for ${authz.identifier.value}`);
        }

        logger.verbose(`Get the challenge key for ${authz.identifier.value}`);
        const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);
        try {
            logger.verbose(`Satisfy challenge for ${authz.identifier.value}`);
            await azureDnsCreateChallenge(logger, certRequest.azure, dnsClient, authz, keyAuthorization);

            logger.verbose(`Verify challenge for ${authz.identifier.value}`);
            await client.verifyChallenge(authz, challenge);

            logger.verbose(`Complete challenge for ${authz.identifier.value}`);
            await client.completeChallenge(challenge);

            logger.verbose(`Wait for valid status for ${authz.identifier.value}`);
            await client.waitForValidStatus(challenge);
        }
        finally {
            try {
                logger.verbose(`Clean up challenge response for ${authz.identifier.value}`);
                await azureDnsRemoveChallenge(logger, certRequest.azure, dnsClient, authz);
            }
            catch (e) {
                logger.error(`Challenge clean-up failed for ${authz.identifier.value}`);
            }
        }
    }));

    logger('Finalizing order');
    await client.finalizeOrder(order, csr);

    logger('Fetching certificate');
    return await client.getCertificate(order);
};

// Runtime type check for non-empty arrays
const isNonEmptyArray = <T extends unknown>(a: T[]): a is ArrayOneOrMore<T> => {
    return a.length > 0;
};

// Convert the certificate options to a certificate policy
// that can be used for provisioning the cert in Azure Key Vault
const certPolicyFromOptions = (certKey: CertKeyOptions): CertificatePolicy => {
    const altNames =
        (typeof certKey.alternativeNames !== 'undefined' && isNonEmptyArray(certKey.alternativeNames))
        ? { dnsNames: certKey.alternativeNames }
        : undefined;

    return {
        issuerName: 'Unknown',
        keySize: certKey.keySize || 2048,
        subject: [`CN=${certKey.commonName}`, certKey.subject].join(' '),
        subjectAlternativeNames: altNames,
        validityInMonths: 3, // 3 = 90 days
        exportable: certKey.exportable,
    };
};

// Generate a new certificate key in Key Vault and return the CSR
const generateNewCertKey = async (
    certClient: CertificateClient,
    certRequest: CertRequest
): Promise<string> => {
    const createPoller = await certClient.beginCreateCertificate(
        certRequest.azure.keyVaultCertName,
        certPolicyFromOptions(certRequest.certKey)
    );
    createPoller.stopPolling();

    const poller = await certClient.getCertificateOperation(certRequest.azure.keyVaultCertName);
    const operation = poller.getOperationState().certificateOperation;
    return [
        '-----BEGIN CERTIFICATE REQUEST-----',
        Buffer.from(operation.csr).toString('base64'),
        '-----END CERTIFICATE REQUEST-----',
    ].join('\n');
};

// Store the validated certificate in Key Vault
const storeCertificate = async (
    certClient: CertificateClient,
    opts: AzureOptions,
    certificate: string,
): Promise<void> => {
    await certClient.mergeCertificate(opts.keyVaultCertName, [Buffer.from(certificate)]);
};

// Entrypoint
export const run = async (logger: Logger, azureCredential: TokenCredential, certRequest: CertRequest): Promise<void> => {
    const legacyAzureCredential = new AzureIdentityCredentialAdapter(azureCredential);
    const keyVaultUrl = `https://${certRequest.azure.keyVaultName}.vault.azure.net`
    const certClient = new CertificateClient(keyVaultUrl, azureCredential);
    const dnsClient = new DnsManagementClient(legacyAzureCredential, certRequest.azure.subscriptionId);

    logger.info(`Generating certificate "${certRequest.azure.keyVaultCertName}" for Key Vault ${certRequest.azure.keyVaultName}`);
    const csr = await generateNewCertKey(certClient, certRequest);

    logger.info(`Ordering a certificate for "${certRequest.certKey.commonName}"`);
    const certificate = await orderCertificate(dnsClient, logger, certRequest, csr);

    logger.info(`Storing certificate for "${certRequest.azure.keyVaultCertName}" in Key Vault ${certRequest.azure.keyVaultName}`);
    await storeCertificate(certClient, certRequest.azure, certificate);
};
