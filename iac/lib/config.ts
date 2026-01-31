const STAGE_NAMES = ['dev', 'prd'] as const;
type StageName = (typeof STAGE_NAMES)[number];

export interface AppParameter {
  projectName: { long: string; short: string };
  stageName: { long: StageName; short: string };
  cdkEnv: { account: string };
  ssm: {
    agentCore: { runtimeArn: string };
  };
}

const stageNameMap: { [key in StageName]: { long: StageName; short: string } } = {
  dev: { long: 'dev', short: 'd' },
  prd: { long: 'prd', short: 'p' },
};

const commonParameters = {
  projectName: {
    long: 'agent-core-playground',
    short: 'acp',
  },
};

const stageConfig: {
  [key in StageName]: Omit<AppParameter, 'cdkEnv' | 'ssm'>;
} = {
  dev: {
    ...commonParameters,
    stageName: stageNameMap.dev,
  },
  prd: {
    ...commonParameters,
    stageName: stageNameMap.prd,
  },
};

const isEnv = (value: string): value is StageName => {
  return (STAGE_NAMES as readonly string[]).includes(value);
};

export const getConfig = (stageName: string): AppParameter => {
  if (!isEnv(stageName)) {
    throw new Error(`Invalid stage name: ${stageName}. Must be one of: ${STAGE_NAMES.join(', ')}`);
  }

  const config = stageConfig[stageName];
  const account = process.env.CDK_DEFAULT_ACCOUNT;

  if (!account) {
    throw new Error('CDK_DEFAULT_ACCOUNT is not set');
  }

  const ssmPrefix = `/${config.stageName.long}/${config.projectName.long}`;

  return {
    ...config,
    cdkEnv: {
      account,
    },
    ssm: {
      agentCore: {
        runtimeArn: `${ssmPrefix}/agent-core/runtime-arn`,
      },
    },
  };
};
