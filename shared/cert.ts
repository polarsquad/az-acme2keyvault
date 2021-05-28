// Check if a timestamp is old enough.
// Used for checking if a certificate is due for renewal
export const isOldEnough = (now: Date, expiryDate: Date, thresholdDays: number): boolean => {
    const timeUntilExpiration = expiryDate.getTime() - now.getTime();
    const daysUntilExpiration = timeUntilExpiration / (1000 * 60 * 60 * 24);
    return daysUntilExpiration <= thresholdDays;
};

