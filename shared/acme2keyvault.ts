import { Logger } from '@azure/functions'
import * as acme from 'acme-client';
import * as forge from 'node-forge';
import { AzureIdentityCredentialAdapter, ServiceClientCredentials } from '@azure/ms-rest-js';
import { TokenCredential } from '@azure/identity';
import { CertificateClient } from '@azure/keyvault-certificates';
import { DnsManagementClient } from '@azure/arm-dns';
import { AzureOptions, CertRequest } from './certRequest';

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
): Promise<any> => {
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
): Promise<any> => {
    const relativeDomain = authzToRelativeDomain(opts.dnsZone, authz);
    logger.verbose(`Deleting TXT record "${relativeDomain}"`);
    await dnsClient.recordSets.deleteMethod(
        opts.dnsZoneResourceGroup, opts.dnsZone,
        relativeDomain, 'TXT'
    );
};

// Order a certificate using the ACME protocol
const orderCertificate = async (
    credential: ServiceClientCredentials,
    logger: Logger,
    certRequest: CertRequest,
    csr: Buffer
): Promise<string> => {
    const dnsClient = new DnsManagementClient(credential, certRequest.azure.subscriptionId);

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
        identifiers: [certRequest.csr.commonName, ...certRequest.csr.altNames].map(
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

// A certificate and private key bundle.
// Both are in PEM format.
interface CertificateBundle {
    privateKey: Buffer,
    certificate: string
}

// Store the given certificate to Key Vault in a Key Vault compatible format.
const storeCertificateToKeyVault = async (
    credential: TokenCredential,
    opts: AzureOptions,
    certBundle: CertificateBundle
): Promise<void> => {
    const keyVaultUrl = `https://${opts.keyVaultName}.vault.azure.net`
    const certClient = new CertificateClient(keyVaultUrl, credential);
    const buffer = Buffer.from(certificateBundleToString(certBundle));
    await certClient.importCertificate(
        opts.keyVaultCertName, buffer,
        { enabled: true, }
    );
};

// Convert a certificate bundle to an Azure Key Vault compatible string.
// Key Vault expects a PKCS#8 format PEM key with the PEM certificate chain concatenated.
const certificateBundleToString = (certBundle: CertificateBundle): string => {
    const privateKey = forge.pki.privateKeyFromPem(certBundle.privateKey.toString());
    const rsaPrivateKey = forge.pki.privateKeyToAsn1(privateKey);
    const privateKeyInfo = forge.pki.wrapRsaPrivateKey(rsaPrivateKey);
    const privateKeyPem = forge.pki.privateKeyInfoToPem(privateKeyInfo);
    return [
        certBundle.certificate,
        privateKeyPem,
    ].join('\n\n');
};

// Entrypoint
export const run = async (logger: Logger, azureCredential: TokenCredential, certRequest: CertRequest): Promise<void> => {
    const legacyAzureCredential = new AzureIdentityCredentialAdapter(azureCredential);

    logger.info(`Creating a new key and CSR for ${certRequest.csr.commonName}`);
    const [privateKey, csr] = await acme.forge.createCsr(certRequest.csr);

    logger.info(`Ordering a certificate for ${certRequest.csr.commonName}`);
    const certificate = await orderCertificate(legacyAzureCredential, logger, certRequest, csr);

    logger.info(`Storing certificate "${certRequest.csr.commonName}" to Key Vault ${certRequest.azure.keyVaultName}`);
    await storeCertificateToKeyVault(azureCredential, certRequest.azure, { privateKey, certificate });
};
