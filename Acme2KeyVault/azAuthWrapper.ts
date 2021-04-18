// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

// This module contains a wrapper for azure-identity credentials
// that can be used with libraries that depend on az-rest-*.
// Copied from here:
// https://github.com/Azure/ms-rest-js/blob/f6f0d92d79a1dfa8d92ff0891b88bc6b7a349e69/lib/credentials/azureIdentityTokenCredentialAdapter.ts

import { TokenCredential } from "@azure/core-auth";

const DEFAULT_AUTHORIZATION_SCHEME = "Bearer";

export class AzureIdentityCredentialAdapter {
    private azureTokenCredential: TokenCredential;
    private scopes: string | string[];
    constructor(
        azureTokenCredential: TokenCredential,
        scopes: string | string[] = "https://management.azure.com/.default"
    ) {
        this.azureTokenCredential = azureTokenCredential;
        this.scopes = scopes;
    }

    public async getToken(): Promise<any> {
        const accessToken = await this.azureTokenCredential.getToken(this.scopes);
        if (accessToken !== null) {
            const result = {
                accessToken: accessToken.token,
                tokenType: DEFAULT_AUTHORIZATION_SCHEME,
                expiresOn: accessToken.expiresOnTimestamp,
            };
            return result;
        } else {
            throw new Error("Could find token for scope");
        }
    }

    public async signRequest(webResource: any) {
        const tokenResponse = await this.getToken();
        webResource.headers.set(
            "authorization",
            `${tokenResponse.tokenType} ${tokenResponse.accessToken}`
        );
        return Promise.resolve(webResource);
    }
}
