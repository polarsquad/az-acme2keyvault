import * as df from 'durable-functions';
import { AzureFunction, Context } from '@azure/functions';

// Entrypoint
const azureFunc: AzureFunction = async (context: Context): Promise<void> => {
    const client = df.getClient(context);
    const instanceId = await client.startNew('AcmeRenewCoordinator');
    context.log.verbose(`Started renew coordinator instance ${instanceId}`);
};
export default azureFunc;
