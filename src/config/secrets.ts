import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

interface Secrets {
  JWT_SECRET: string;
  GHL_CLIENT_ID: string;
  GHL_CLIENT_SECRET: string;
  DATABASE_URL: string;
  ENCRYPTION_KEY: string;
}

let cachedSecrets: Secrets | null = null;

export async function getSecrets(): Promise<Secrets> {
  if (cachedSecrets) {
    return cachedSecrets;
  }

  const environment = process.env.NODE_ENV || 'development';
  const secretName = `${environment}/apcs-platform`;

  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );

    if (!response.SecretString) {
      throw new Error('Secret string is empty');
    }

    cachedSecrets = JSON.parse(response.SecretString) as Secrets;
    console.log('✅ Secrets loaded from AWS Secrets Manager');
    return cachedSecrets;
  } catch (error) {
    console.error('❌ Failed to load secrets from AWS Secrets Manager:', error);
    
    // Fallback to environment variables in development only
    if (environment === 'development') {
      console.warn('⚠️ Using .env fallback in development mode');
      cachedSecrets = {
        JWT_SECRET: process.env.JWT_SECRET!,
        GHL_CLIENT_ID: process.env.GHL_CLIENT_ID!,
        GHL_CLIENT_SECRET: process.env.GHL_CLIENT_SECRET!,
        DATABASE_URL: process.env.DATABASE_URL!,
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
      };
      return cachedSecrets;
    }
    
    throw new Error('Failed to load secrets in production');
  }
}

// Initialize secrets on startup
export async function initSecrets() {
  await getSecrets();
}