import Ajv, { JTDParser } from 'ajv/dist/jtd';
import { CsrOptions } from 'acme-client';

// Options for Azure services
export interface AzureOptions {
    subscriptionId: string;
    dnsZoneResourceGroup: string;
    dnsZone: string;
    keyVaultName: string;
    keyVaultCertName: string;
}

// Options for ACME directory interactions
export interface AcmeOptions {
    contactEmail: string;
    acmeDirectoryUrl: string;
}

// All options in one package
export interface CertRequest {
    azure: AzureOptions;
    acme: AcmeOptions;
    csr: CsrOptions;
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
                acmeDirectoryUrl: {type: 'string'},
            }
        },
        csr: {
            properties: {
                commonName: {type: 'string'},
            },
            optionalProperties: {
                keySize: {type: 'int16'},
                altNames: {elements: {type: 'string'}},
                country: {type: 'string'},
                state: {type: 'string'},
                locality: {type: 'string'},
                organization: {type: 'string'},
                organizationUnit: {type: 'string'},
                emailAddress: {type: 'string'},
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
