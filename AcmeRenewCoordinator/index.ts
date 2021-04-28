import * as df from 'durable-functions';
import { AzureFunction } from '@azure/functions';

// Entrypoint
const orchestrator: AzureFunction = df.orchestrator(function* (context) {
    const tasks = [];

    context.log.verbose('Fetching certificates that require a renewal');
    const certRequests: any[] = yield context.df.callActivity('AcmeCertList');

    if (certRequests.length === 0) {
        context.log.verbose('No certificates need to be renewed.');
        return;
    }

    context.log.info(`Renewing ${certRequests.length} certificates`);
    for (const certRequest of certRequests) {
        tasks.push(context.df.callActivity('Acme2KeyVaultActivity', certRequest));
    }
    yield context.df.Task.all(tasks);
});
export default orchestrator;
