// Get a required configuration from environment variables.
// Throws an error when the configuration is missing.
export const req = (key: string): string => {
    const v = process.env[key];
    if (typeof v === 'undefined') {
        throw new Error(`Missing configuration "${key}"`);
    }
    return v;
};

// Get an optional configuration from environment variables.
// Undefined is returned when the configuration is missing.
export const opt = (key: string): string | undefined => {
    return process.env[key];
};
