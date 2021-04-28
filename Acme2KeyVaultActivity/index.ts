import { AzureFunction, Context } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import { CertRequest } from '../shared/certRequest';
import * as acme2keyvault from '../shared/acme2keyvault';

// Azure access
const credential = new DefaultAzureCredential();

// Entrypoint
const azureFunc: AzureFunction = async (context: Context, certRequest: CertRequest): Promise<void> => {
    await acme2keyvault.run(context.log, credential, certRequest);
};
export default azureFunc;
