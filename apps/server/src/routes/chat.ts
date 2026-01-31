import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { HttpRequest } from '@smithy/types';
import { SignatureV4 } from '@smithy/signature-v4';
import { Hono } from 'hono';

const AWS_REGION = process.env.AWS_REGION || 'ap-northeast-1';
const AGENT_RUNTIME_ARN_SSM_PARAM = process.env.AGENT_RUNTIME_ARN_SSM_PARAM || '';

// SSMからAgentCore Runtime ARNを取得（キャッシュ）
let cachedAgentRuntimeArn: string | null = null;

async function getAgentRuntimeArn(): Promise<string> {
  if (cachedAgentRuntimeArn) {
    return cachedAgentRuntimeArn;
  }

  if (!AGENT_RUNTIME_ARN_SSM_PARAM) {
    throw new Error('AGENT_RUNTIME_ARN_SSM_PARAM is not configured');
  }

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: AWS_REGION,
    service: 'ssm',
    sha256: Sha256,
  });

  const hostname = `ssm.${AWS_REGION}.amazonaws.com`;

  const request: HttpRequest = {
    method: 'POST',
    protocol: 'https:',
    hostname,
    path: '/',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AmazonSSM.GetParameter',
      host: hostname,
    },
    body: JSON.stringify({ Name: AGENT_RUNTIME_ARN_SSM_PARAM }),
  };

  const signedRequest = await signer.sign(request);

  const response = await fetch(`https://${hostname}/`, {
    method: 'POST',
    headers: signedRequest.headers as HeadersInit,
    body: request.body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SSM GetParameter error: ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as { Parameter?: { Value?: string } };
  const arn = result.Parameter?.Value;

  if (!arn) {
    throw new Error('AgentCore Runtime ARN not found in SSM');
  }

  cachedAgentRuntimeArn = arn;
  return arn;
}

interface ChatRequest {
  message: string;
  sessionId: string;
}

export const chatRoute = new Hono();

chatRoute.post('/chat', async (c) => {
  const body = await c.req.json<ChatRequest>();
  const { message, sessionId } = body;

  if (!message || !sessionId) {
    return c.json({ error: 'message and sessionId are required' }, 400);
  }

  try {
    const agentRuntimeArn = await getAgentRuntimeArn();
    const payload = JSON.stringify({ prompt: message });

    const signer = new SignatureV4({
      credentials: defaultProvider(),
      region: AWS_REGION,
      service: 'bedrock-agentcore',
      sha256: Sha256,
    });

    const arnEncoded = encodeURIComponent(agentRuntimeArn);
    const hostname = `bedrock-agentcore.${AWS_REGION}.amazonaws.com`;
    const path = `/runtimes/${arnEncoded}/invocations`;

    const request: HttpRequest = {
      method: 'POST',
      protocol: 'https:',
      hostname,
      path,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
        host: hostname,
      },
      body: payload,
    };

    const signedRequest = await signer.sign(request);
    const url = `https://${hostname}${path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: signedRequest.headers as HeadersInit,
      body: payload,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return c.json({ error: `AgentCore API error: ${response.status} - ${errorText}` }, 500);
    }

    // AgentCoreのレスポンスをそのままプロキシ
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('AgentCore error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: errorMessage }, 500);
  }
});
