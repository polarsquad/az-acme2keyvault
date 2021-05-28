// Check if a timestamp is old enough.
// Used for checking if a certificate is due for renewal
export const isOldEnough = (now: Date, expiryDate: Date, thresholdDays: number): boolean => {
    const timeUntilExpiration = expiryDate.getTime() - now.getTime();
    const daysUntilExpiration = timeUntilExpiration / (1000 * 60 * 60 * 24);
    return daysUntilExpiration <= thresholdDays;
};

// Convert CSR bytes to PEM formatted string
export const csrBytesToPem = (bytes: Uint8Array): string => {
    return [
        '-----BEGIN CERTIFICATE REQUEST-----',
        Buffer.from(bytes).toString('base64'),
        '-----END CERTIFICATE REQUEST-----',
    ].join('\n');
}
