import Ajv, { JTDParser } from 'ajv/dist/jtd';

// Options for Azure services
export interface AzureOptions {
    subscriptionId: string;
    dnsZoneResourceGroup: string;
    dnsZone: string;
    keyVaultName: string;
    keyVaultCertName: string;
}

export const keyVaultLogStr = (azureOpts: AzureOptions): string => {
    return `${azureOpts.keyVaultCertName} in Key Vault ${azureOpts.keyVaultName}`;
}

// Options for ACME directory interactions
export interface AcmeOptions {
    contactEmail: string;
    directoryUrl: string;
}

// Options for the certificate key
export interface CertKeyOptions {
    commonName: string;
    subject?: string;
    alternativeNames?: string[];
    keySize?: number;
    exportable?: boolean;
}

// All options in one package
export interface CertRequest {
    azure: AzureOptions;
    acme: AcmeOptions;
    certKey: CertKeyOptions;
}

const ajv = new Ajv();
const jsonParser: JTDParser<CertRequest> = ajv.compileParser({
    properties: {
        azure: {
            properties: {
                subscriptionId: {type: 'string'},
                dnsZoneResourceGroup: {type: 'string'},
                dnsZone: {type: 'string'},
                keyVaultName: {type: 'string'},
                keyVaultCertName: {type: 'string'},
            }
        },
        acme: {
            properties: {
                contactEmail: {type: 'string'},
                directoryUrl: {type: 'string'},
            }
        },
        certKey: {
            properties: {
                commonName: {type: 'string'},
            },
            optionalProperties: {
                subject: {type: 'string'},
                keySize: {type: 'int16'},
                alternativeNames: {elements: {type: 'string'}},
                exportable: {type: 'boolean'}
            }
        }
    }
});

// Parse option from given JSON string
export const fromJson = (json: string): CertRequest => {
    const options = jsonParser(json);
    if (typeof options === 'undefined') {
        throw new Error(
            `Failed to parse JSON to Options at ${jsonParser.position}: ${jsonParser.message}`
        );
    }
    return options;
};
