# ACME (Let's Encrypt) certificate to Azure KeyVault

Azure Function for automating [ACME/Let's Encrypt](https://letsencrypt.org/) TLS certificate generation and renewal.
The certificates are validated using Azure DNS and published to Azure Key Vault.

## Dependencies

This code depends on the following Azure services.

### Azure Functions

The code is meant to be run on [Azure Functions](https://azure.microsoft.com/en-us/services/functions/).
To creat the required supporting resources in Azure, [follow the official guide](https://docs.microsoft.com/en-us/azure/azure-functions/create-first-function-cli-typescript?tabs=azure-cli%2Cbrowser#create-supporting-azure-resources-for-your-function).

For more details on how to run and develop Azure Functions, [see the official documentation](https://docs.microsoft.com/en-us/azure/azure-functions/).

### Azure DNS

The code assumes that your domain records are hosted on [Azure DNS](https://azure.microsoft.com/en-us/services/dns/).
The domain verification is done by creating a TXT record on the chosen DNS zone.
To set up a DNS zone in Azure, [follow the official guide](https://docs.microsoft.com/en-us/azure/dns/dns-getstarted-portal).

### Azure Key Vault

The code stores the TLS certificate (and the private key) in [Azure Key Vault](https://azure.microsoft.com/en-us/services/key-vault/).
To set up a Key Vault in Azure, [follow the official guide](https://docs.microsoft.com/en-us/azure/key-vault/general/quick-create-portal).

### IAM permissions for the Function

Since the code will modify the Azure DNS and Key Vault, access must be granted to it using RBAC (role-based access control).

To get started, we need to assign an identity for the Function that runs the code. The best approach is to use [a managed identity](https://docs.microsoft.com/en-us/azure/app-service/overview-managed-identity?toc=%2Fazure%2Fazure-functions%2Ftoc.json&tabs=dotnet) for this.

Once you've created the managed identity, you need to grant it access to the DNS zone and Key Vault the code will modify.

* For the DNS zone, you'll need to grant access to modify TXT records.
* For the Key Vault, you'll need to grant access to import new certificates.

## Configuration

The function can be configured with the following environment variables:

* Azure configurations
  * `AZURE_SUBSCRIPTION_ID`: The ID of the Azure subscription where the Azure DNS is located
  * `DNS_ZONE_RESOURCE_GROUP`: The name of the resource group where the DNS zone is located
  * `DNS_ZONE`: The name of the DNS zone
  * `KEYVAULT_URL`: The URL of the Key Vault.
    Typically it would be `https://${key-vault-name}.vault.azure.net` where `${key-vault-name}` is the name of the Key Vault.
  * `KEYVAULT_CERT_NAME`: The name of the certificate in Key Vault.
* ACME / Let's Encrypt configurations
  * `ACME_CONTACT_EMAIL`: The contact email address to use when registering a certificate
  * `ACME_DIRECTORY_URL`: The URL of the ACME directory that signs the TLS certificate. With Let's Encrypt, typically either of these would be used:
    * Staging: `https://acme-staging-v02.api.letsencrypt.org/directory`
    * Production: `'https://acme-v02.api.letsencrypt.org/directory`
* Certificate settings
  * `CERT_COMMON_NAME`: The domain name to use for the certificate
  * `CERT_ALTERNATIVE_NAMES`: The alternative domain names to use for certificate
  * `CERT_KEY_SIZE` (optional): The size (number of bits) of the private key. Default: `2048`.
  * `CERT_COUNTRY` (optional): The country field in the certificate
  * `CERT_STATE` (optional): The state field in the certificate
  * `CERT_LOCALITY` (optional): The locality field in the certificate
  * `CERT_ORGANIZATION` (optional): The organization field in the certificate
  * `CERT_ORGANIZATION_UNIT` (optional): The organization unit field in the certificate
  * `CERT_EMAIL_ADDRESS` (optional): The email address field in the certificate

## Build and deploy

The code can be built using the following NPM command:

```
npm run build
```

Once you've set up the surrounding infrastructure in Azure, you can deploy the function with the [Azure Functions Core Tools](https://docs.microsoft.com/en-us/azure/azure-functions/functions-run-local#v2):

```
func azure functionapp publish <APP_NAME>
```

## License

MIT License

See [LICENSE](LICENSE) for more details.
