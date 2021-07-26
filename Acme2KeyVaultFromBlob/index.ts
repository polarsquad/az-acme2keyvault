import { AzureFunction, Context } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import * as certRequest from '../shared/certRequest';
import * as acme2keyvault from '../shared/acme2keyvault';

// Entrypoint
const azureFunc: AzureFunction = async (context: Context, certRequestBlob: Buffer): Promise<void> => {
    const credential = new DefaultAzureCredential();
    const cr = certRequest.fromJson(certRequestBlob.toString())
    await acme2keyvault.run(context.log, credential, cr);
};
export default azureFunc;
