import { AzureFunction, Context } from '@azure/functions'
import * as acme from 'acme-client';
import * as forge from 'node-forge';
import { AzureIdentityCredentialAdapter } from './azAuthWrapper';
import { DefaultAzureCredential } from '@azure/identity';
import { CertificateClient } from '@azure/keyvault-certificates';
import { DnsManagementClient } from '@azure/arm-dns';

// Get a required configuration from environment variables.
// Throws an error when the configuration is missing.
const reqConfig = (key: string): string => {
    const v = process.env[key];
    if (typeof v === 'undefined') {
        throw new Error(`Missing configuration "${key}"`);
    }
    return v;
};

// Get an optional configuration from environment variables.
// Undefined is returned when the configuration is missing.
const optConfig = (key: string): string | undefined => {
    return process.env[key];
};

// Azure configurations
const subscriptionId = reqConfig('AZURE_SUBSCRIPTION_ID');
const dnsZoneRg = reqConfig('DNS_ZONE_RESOURCE_GROUP');
const dnsZone = reqConfig('DNS_ZONE');
const keyVaultUrl = reqConfig('KEYVAULT_URL');
const keyVaultCertName = reqConfig('KEYVAULT_CERT_NAME');

// ACME configurations
const contactEmail = reqConfig('ACME_CONTACT_EMAIL');
const acmeDirectoryUrl = reqConfig('ACME_DIRECTORY_URL');

// TLS cert configurations
const certDetails: acme.CsrOptions = {
    keySize: Number.parseInt(optConfig('CERT_KEY_SIZE') || '2048', 10),
    commonName: reqConfig('CERT_COMMON_NAME'),
    altNames: (optConfig('CERT_ALTERNATIVE_NAMES') || '').split(','),
    country: optConfig('CERT_COUNTRY'),
    state: optConfig('CERT_STATE'),
    locality: optConfig('CERT_LOCALITY'),
    organization: optConfig('CERT_ORGANIZATION'),
    organizationUnit: optConfig('CERT_ORGANIZATION_UNIT'),
    emailAddress: optConfig('CERT_EMAIL_ADDRESS')
};

// Azure access
const credential = new DefaultAzureCredential();
const legacyCredential = new AzureIdentityCredentialAdapter(credential);
const certClient = new CertificateClient(keyVaultUrl, credential);
const dnsClient = new DnsManagementClient(legacyCredential, subscriptionId);

// Convert the ACME authorization detail to validation domain
// that's compatible with Azure DNS format.
const authzToRelativeDomain = (authz: acme.Authorization): string => {
    const relativeDomain = authz.identifier.value.replace(`.${dnsZone}`, '');
    return `_acme-challenge.${relativeDomain}`;
};

// Create a record set in Azure DNS for the given ACME DNS challenge.
const azureDnsCreateChallenge = async (
    context: Context,
    authz: acme.Authorization,
    keyAuthorization: string
): Promise<any> => {
    const relativeDomain = authzToRelativeDomain(authz)
    context.log.verbose(`Creating TXT record: "${relativeDomain}" = "${keyAuthorization}"`);
    await dnsClient.recordSets.createOrUpdate(
        dnsZoneRg, dnsZone,
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
    context: Context,
    authz: acme.Authorization,
): Promise<any> => {
    const relativeDomain = authzToRelativeDomain(authz)
    context.log.verbose(`Deleting TXT record "${relativeDomain}"`);
    await dnsClient.recordSets.deleteMethod(
        dnsZoneRg, dnsZone,
        authzToRelativeDomain(authz), 'TXT'
    );
};

// Order a certificate using the ACME protocol
const orderCertificate = async (context: Context, csr: Buffer): Promise<string> => {
    const client = new acme.Client({
        directoryUrl: acmeDirectoryUrl,
        accountKey: await acme.forge.createPrivateKey(),
    });

    context.log.verbose('Register account');
    await client.createAccount({
        termsOfServiceAgreed: true,
        contact: [`mailto:${contactEmail}`],
    });

    context.log.verbose('Place new order');
    const order = await client.createOrder({
        identifiers: [certDetails.commonName, ...certDetails.altNames].map(
            (domain) => ({type: 'dns', value: domain})
        )
    });

    context.log.verbose('Get authorizations for order');
    const authorizations = await client.getAuthorizations(order);
    await Promise.all(authorizations.map(async (authz) => {
        // Only the DNS challenge is supported
        const challenge = authz.challenges.find(
            (challenge) => challenge.type === 'dns-01'
        );
        if (!challenge) {
            throw new Error(`No DNS challenge found for ${authz.identifier.value}`);
        }

        context.log.verbose(`Get the challenge key for ${authz.identifier.value}`);
        const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);
        try {
            context.log.verbose(`Satisfy challenge for ${authz.identifier.value}`);
            await azureDnsCreateChallenge(context, authz, keyAuthorization);

            context.log.verbose(`Verify challenge for ${authz.identifier.value}`);
            await client.verifyChallenge(authz, challenge);

            context.log.verbose(`Complete challenge for ${authz.identifier.value}`);
            await client.completeChallenge(challenge);

            context.log.verbose(`Wait for valid status for ${authz.identifier.value}`);
            await client.waitForValidStatus(challenge);
        }
        finally {
            try {
                context.log.verbose(`Clean up challenge response for ${authz.identifier.value}`);
                await azureDnsRemoveChallenge(context, authz);
            }
            catch (e) {
                context.log.error(`Challenge clean-up failed for ${authz.identifier.value}`);
            }
        }
    }));

    context.log('Finalizing order');
    await client.finalizeOrder(order, csr);

    context.log('Fetching certificate');
    return await client.getCertificate(order);
};

// A certificate and private key bundle.
// Both are in PEM format.
interface CertificateBundle {
    privateKey: Buffer,
    certificate: string
}

// Store the given certificate to Key Vault in a Key Vault compatible format.
const storeCertificateToKeyVault = async (certBundle: CertificateBundle): Promise<void> => {
    const buffer = Buffer.from(certificateBundleToString(certBundle));
    await certClient.importCertificate(
        keyVaultCertName, buffer,
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
const timerTrigger: AzureFunction = async (context: Context): Promise<void> => {
    context.log.info(`Creating a new key and CSR for ${certDetails.commonName}`);
    const [privateKey, csr] = await acme.forge.createCsr(certDetails);

    context.log.info(`Ordering a certificate for ${certDetails.commonName}`);
    const certificate = await orderCertificate(context, csr);

    context.log.info(`Storing certificate "${certDetails.commonName}" to Key Vault ${keyVaultUrl}`);
    await storeCertificateToKeyVault({ privateKey, certificate });
};

export default timerTrigger;
