import { useCallback, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface AgentNode {
  nodeId: string;
  status: 'pending' | 'running' | 'completed';
  content: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agents?: AgentNode[];
}

const AGENT_CONFIG: Record<
  string,
  { name: string; icon: string; color: string; layer: 'parallel' | 'final' }
> = {
  tech: { name: '技術観点', icon: '⚙️', color: '#3b82f6', layer: 'parallel' },
  social: { name: '社会観点', icon: '🌍', color: '#8b5cf6', layer: 'parallel' },
  ethics: { name: '倫理観点', icon: '⚖️', color: '#f59e0b', layer: 'parallel' },
  writer: { name: '執筆担当', icon: '✍️', color: '#10b981', layer: 'final' },
};

function getAgentConfig(nodeId: string) {
  return AGENT_CONFIG[nodeId] || { name: nodeId, icon: '🤖', color: '#6b7280', layer: 'parallel' };
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      agents: [],
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      abortControllerRef.current = new AbortController();

      const response = await fetch('./api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          sessionId,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              let parsed = JSON.parse(data);
              // AgentCoreからの二重エンコードを処理
              if (typeof parsed === 'string') {
                parsed = JSON.parse(parsed);
              }

              if (parsed.event === 'node_start') {
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== assistantMessage.id) return msg;
                    const agents = msg.agents || [];
                    const existingIndex = agents.findIndex((a) => a.nodeId === parsed.node_id);
                    if (existingIndex >= 0) {
                      const updated = [...agents];
                      updated[existingIndex] = { ...updated[existingIndex], status: 'running' };
                      return { ...msg, agents: updated };
                    }
                    return {
                      ...msg,
                      agents: [
                        ...agents,
                        { nodeId: parsed.node_id, status: 'running', content: '' },
                      ],
                    };
                  })
                );
              } else if (parsed.event === 'node_stream') {
                // 逐次レンダリング: ストリーミング中のテキストを追加
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== assistantMessage.id) return msg;
                    const agents = msg.agents || [];
                    const existingIndex = agents.findIndex((a) => a.nodeId === parsed.node_id);
                    if (existingIndex >= 0) {
                      const updated = [...agents];
                      updated[existingIndex] = {
                        ...updated[existingIndex],
                        content: updated[existingIndex].content + (parsed.text || ''),
                      };
                      return { ...msg, agents: updated };
                    }
                    return msg;
                  })
                );
              } else if (parsed.event === 'node_stop') {
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== assistantMessage.id) return msg;
                    const agents = msg.agents || [];
                    const existingIndex = agents.findIndex((a) => a.nodeId === parsed.node_id);
                    if (existingIndex >= 0) {
                      const updated = [...agents];
                      updated[existingIndex] = {
                        ...updated[existingIndex],
                        status: 'completed',
                        content: parsed.content || '',
                      };
                      return { ...msg, agents: updated };
                    }
                    return {
                      ...msg,
                      agents: [
                        ...agents,
                        {
                          nodeId: parsed.node_id,
                          status: 'completed',
                          content: parsed.content || '',
                        },
                      ],
                    };
                  })
                );
              } else if (parsed.event === 'complete') {
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== assistantMessage.id) return msg;
                    const agents = msg.agents || [];
                    const writerAgent = agents.find((a) => a.nodeId === 'writer');
                    return { ...msg, content: writerAgent?.content || msg.content };
                  })
                );
              } else if (parsed.content) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id ? { ...msg, content: parsed.content } : msg
                  )
                );
              }
            } catch {
              // JSON パースエラーは無視
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id
            ? {
                ...msg,
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, isLoading, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // エージェントを並列層と最終層に分類
  const categorizeAgents = (agents: AgentNode[]) => {
    const parallel: AgentNode[] = [];
    const final: AgentNode[] = [];

    for (const agent of agents) {
      const config = getAgentConfig(agent.nodeId);
      if (config.layer === 'final') {
        final.push(agent);
      } else {
        parallel.push(agent);
      }
    }

    return { parallel, final };
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Graph Multi-Agent Chat</h1>
      </div>

      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          minHeight: '500px',
          padding: '20px',
          marginBottom: '20px',
        }}
      >
        {messages.length === 0 ? (
          <p style={{ color: '#888', textAlign: 'center' }}>
            メッセージを入力して会話を開始してください
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                marginBottom: '20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              {/* ユーザーメッセージ */}
              {msg.role === 'user' && (
                <div
                  style={{
                    backgroundColor: '#007bff',
                    color: 'white',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    maxWidth: '80%',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.content}
                </div>
              )}

              {/* Assistantメッセージ - エージェントフロー */}
              {msg.role === 'assistant' && (
                <div style={{ width: '100%' }}>
                  {/* Graph Agent フロー表示 */}
                  {msg.agents &&
                    msg.agents.length > 0 &&
                    (() => {
                      const { parallel, final } = categorizeAgents(msg.agents);

                      return (
                        <div style={{ marginBottom: '16px' }}>
                          {/* 並列層（横並び） */}
                          {parallel.length > 0 && (
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: `repeat(${parallel.length}, 1fr)`,
                                gap: '12px',
                                marginBottom: '12px',
                              }}
                            >
                              {parallel.map((agent) => {
                                const config = getAgentConfig(agent.nodeId);
                                return (
                                  <div
                                    key={agent.nodeId}
                                    style={{
                                      border: `2px solid ${config.color}`,
                                      borderRadius: '12px',
                                      overflow: 'hidden',
                                      backgroundColor: 'white',
                                      boxShadow:
                                        agent.status === 'running'
                                          ? `0 0 12px ${config.color}40`
                                          : '0 1px 3px rgba(0,0,0,0.1)',
                                      transition: 'box-shadow 0.3s',
                                    }}
                                  >
                                    <div
                                      style={{
                                        backgroundColor: config.color,
                                        color: 'white',
                                        padding: '8px 12px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <span style={{ fontWeight: 'bold', fontSize: '13px' }}>
                                        {config.icon} {config.name}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: '11px',
                                          backgroundColor: 'rgba(255,255,255,0.2)',
                                          padding: '2px 6px',
                                          borderRadius: '8px',
                                        }}
                                      >
                                        {agent.status === 'running' ? '⏳' : '✓'}
                                      </span>
                                    </div>
                                    <div
                                      style={{
                                        padding: '10px',
                                        fontSize: '12px',
                                        color: '#374151',
                                        backgroundColor: '#fafafa',
                                      }}
                                    >
                                      {agent.content ? (
                                        <ReactMarkdown>{agent.content}</ReactMarkdown>
                                      ) : (
                                        <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                                          {agent.status === 'running' ? '処理中...' : '待機中'}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* 矢印（並列層と最終層の間） */}
                          {parallel.length > 0 && final.length > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'center',
                                padding: '8px 0',
                              }}
                            >
                              <span style={{ color: '#9ca3af', fontSize: '24px' }}>↓</span>
                            </div>
                          )}

                          {/* 最終層（執筆担当） */}
                          {final.map((agent) => {
                            const config = getAgentConfig(agent.nodeId);
                            return (
                              <div
                                key={agent.nodeId}
                                style={{
                                  border: `2px solid ${config.color}`,
                                  borderRadius: '12px',
                                  overflow: 'hidden',
                                  backgroundColor: 'white',
                                  boxShadow:
                                    agent.status === 'running'
                                      ? `0 0 12px ${config.color}40`
                                      : '0 1px 3px rgba(0,0,0,0.1)',
                                  transition: 'box-shadow 0.3s',
                                }}
                              >
                                <div
                                  style={{
                                    backgroundColor: config.color,
                                    color: 'white',
                                    padding: '10px 14px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                  }}
                                >
                                  <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
                                    {config.icon} {config.name}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: '12px',
                                      backgroundColor: 'rgba(255,255,255,0.2)',
                                      padding: '2px 8px',
                                      borderRadius: '10px',
                                    }}
                                  >
                                    {agent.status === 'running' ? '⏳ 処理中...' : '✓ 完了'}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    padding: '12px',
                                    fontSize: '13px',
                                    color: '#374151',
                                    backgroundColor: '#fafafa',
                                  }}
                                >
                                  {agent.content ? (
                                    <ReactMarkdown>{agent.content}</ReactMarkdown>
                                  ) : (
                                    <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                                      {agent.status === 'running'
                                        ? '3つの観点を統合中...'
                                        : '待機中'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                  {/* 最終結果（エージェントがない場合、または従来形式） */}
                  {msg.content && !msg.agents?.length && (
                    <div
                      style={{
                        backgroundColor: '#e9ecef',
                        color: 'black',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        maxWidth: '80%',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.content}
                    </div>
                  )}

                  {/* ローディング表示 */}
                  {!msg.content && isLoading && !msg.agents?.length && (
                    <div
                      style={{
                        backgroundColor: '#e9ecef',
                        color: '#666',
                        padding: '10px 14px',
                        borderRadius: '12px',
                      }}
                    >
                      処理中...
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力... (Command+Enter で送信)"
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid #ddd',
            resize: 'none',
            minHeight: '50px',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
          style={{
            padding: '12px 24px',
            backgroundColor: isLoading || !input.trim() ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {isLoading ? '送信中...' : '送信'}
        </button>
      </div>
    </div>
  );
}
