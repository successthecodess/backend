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
  OPENAI_API_KEY: string;

}

let cachedSecrets: Secrets | null = null;

export async function getSecrets(): Promise<Secrets> {
  if (cachedSecrets) {
    return cachedSecrets;
  }

  const environment = process.env.NODE_ENV || 'development';
  
  // Check if running on Railway or other platforms with direct env vars
  const isRailway = process.env.RAILWAY_ENVIRONMENT !== undefined;
  const hasDirectEnvVars = process.env.JWT_SECRET && process.env.DATABASE_URL;
  
  // Use direct env vars if in development, Railway, or env vars are set
  if (environment === 'development' || isRailway || hasDirectEnvVars) {
    console.log('🔧 Loading secrets from environment variables');
    
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is required in environment variables');
    }
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in environment variables');
    }
    
    cachedSecrets = {
      JWT_SECRET: process.env.JWT_SECRET,
      GHL_CLIENT_ID: process.env.GHL_CLIENT_ID || '',
      GHL_CLIENT_SECRET: process.env.GHL_CLIENT_SECRET || '',
      DATABASE_URL: process.env.DATABASE_URL,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || ''
    };
    
    console.log('✅ Secrets loaded from environment variables');
    return cachedSecrets;
  }

  // Only use AWS Secrets Manager if explicitly configured
  const secretName = `${environment}/apcs-platform`;
  console.log(`📦 Loading secrets from AWS Secrets Manager: ${secretName}`);

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
  } catch (error: any) {
    console.error('❌ Failed to load secrets from AWS Secrets Manager:', error);
    throw new Error(`Failed to load secrets: ${error.message}`);
  }
}

// Initialize secrets on startup
export async function initSecrets() {
  await getSecrets();
}