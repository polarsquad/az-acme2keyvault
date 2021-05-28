import { AzureFunction, Context } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { CertificateClient, KeyVaultCertificateWithPolicy } from '@azure/keyvault-certificates';
import { RestError } from '@azure/core-http';
import {
    CertRequest,
    AzureOptions,
    fromJson as certRequestFromJson,
} from '../shared/certRequest';
import * as envConfig from '../shared/envConfig';
import { isOldEnough } from '../shared/cert';

// Config
const certReqConnectionString = envConfig.opt('AzureWebJobsStorage');
const certReqStorageAccount = envConfig.opt('CERT_REQ_STORAGE_ACCOUNT');
const certReqContainer = envConfig.opt('CERT_REQ_CONTAINER') || 'cert-requests';
const renewDaysThreshold = Number.parseInt(envConfig.opt('RENEW_DAYS_THRESHOLD') || '30', 10);
const today = new Date();

// Azure access
const credential = new DefaultAzureCredential();
const blobServiceClient: BlobServiceClient =
    typeof certReqStorageAccount === 'undefined'
        ? BlobServiceClient.fromConnectionString(certReqConnectionString)
        : new BlobServiceClient(
            `https://${certReqStorageAccount}.blob.core.windows.net`,
            credential,
        );
const containerClient = blobServiceClient.getContainerClient(certReqContainer);

// Get all the certificate details from Azure Key Vault
const getCertDetails = async (context: Context, opts: AzureOptions): Promise<KeyVaultCertificateWithPolicy | null> => {
    const keyVaultUrl = `https://${opts.keyVaultName}.vault.azure.net`;
    const certClient = new CertificateClient(keyVaultUrl, credential);

    context.log.verbose(`Fetching certificate details for "${opts.keyVaultCertName} from KV "${opts.keyVaultName}"`);
    try {
        return await certClient.getCertificate(opts.keyVaultCertName);
    } catch (err) {
        if (err instanceof RestError && err.statusCode === 404) {
            return null;
        }
        throw err;
    }
};

// Check if the certificate should be renewed
const shouldRenewCert = (certDetails: KeyVaultCertificateWithPolicy): boolean => {
    return certDetails.properties.enabled
        && isOldEnough(today, certDetails.properties.expiresOn, renewDaysThreshold);
};

// Entrypoint
const azureFunc: AzureFunction = async (context: Context): Promise<CertRequest[]> => {
    const certRequests: CertRequest[] = [];

    context.log.verbose('Listing all blobs');
    for await (const blob of containerClient.listBlobsFlat()) {
        if (blob.name.endsWith('.json')) {
            context.log.verbose(`Fetching JSON blob "${blob.name}"`)
            const blobClient = containerClient.getBlobClient(blob.name);
            const buffer = await blobClient.downloadToBuffer(0);
            const certRequest = certRequestFromJson(buffer.toString());
            const commonName = certRequest.certKey.commonName;
            const certDetails = await getCertDetails(context, certRequest.azure);

            if (certDetails === null) {
                context.log.verbose(`No certificate provisioned for "${commonName}`)
            } else if (shouldRenewCert(certDetails)) {
                certRequests.push(certRequest);
            } else {
                context.log.verbose(`No renewal needed for certificate "${commonName}"`)
            }
        }
    }
    return certRequests;
};
export default azureFunc;
