"""
Strands Agents - Graph Multi-Agent パターン（並列実行）

AWS Bedrock AgentCore Runtime上で動作するマルチエージェント。
3つの観点（技術・社会・倫理）で並列に調査し、最後に執筆担当がまとめる。
"""

import json

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.multiagent import GraphBuilder

# スペシャリストエージェントを作成（3つの観点で並列実行）
tech_researcher = Agent(
    name="tech_researcher",
    system_prompt="あなたは技術観点の調査担当です。与えられたトピックについて、技術的な側面（仕組み、実装、性能など）を調査してまとめてください。日本語で簡潔に回答してください。",
)

social_researcher = Agent(
    name="social_researcher",
    system_prompt="あなたは社会観点の調査担当です。与えられたトピックについて、社会的な側面（影響、トレンド、活用事例など）を調査してまとめてください。日本語で簡潔に回答してください。",
)

ethics_researcher = Agent(
    name="ethics_researcher",
    system_prompt="あなたは倫理観点の調査担当です。与えられたトピックについて、倫理的な側面（課題、リスク、規制など）を調査してまとめてください。日本語で簡潔に回答してください。",
)

writer = Agent(
    name="writer",
    system_prompt="あなたは執筆担当です。3つの観点（技術・社会・倫理）からの調査結果を統合し、わかりやすくまとめてください。語尾は「〜なのだ」でお願いします。日本語で回答してください。",
)

# グラフを構築（並列 → 集約）
builder = GraphBuilder()
builder.add_node(tech_researcher, "tech")
builder.add_node(social_researcher, "social")
builder.add_node(ethics_researcher, "ethics")
builder.add_node(writer, "writer")

# 並列実行: 3つの観点から同時にスタート
builder.set_entry_point("tech")
builder.set_entry_point("social")
builder.set_entry_point("ethics")

# 集約: 3つの結果を執筆担当に渡す
builder.add_edge("tech", "writer")
builder.add_edge("social", "writer")
builder.add_edge("ethics", "writer")

graph = builder.build()

app = BedrockAgentCoreApp()


@app.entrypoint
async def invoke_agent(payload, context):
    """AgentCore Runtimeからの呼び出しハンドラー（ストリーミング対応）"""
    prompt = payload.get("prompt", "No prompt provided")

    # 各ノードのコンテンツを蓄積
    node_contents = {}

    # ストリーミングイベントを発行
    async for event in graph.stream_async(prompt):
        event_type = event.get("type", "")

        if event_type == "multiagent_node_start":
            node_id = event["node_id"]
            node_contents[node_id] = ""
            yield json.dumps({"event": "node_start", "node_id": node_id})

        elif event_type == "multiagent_node_stream":
            # ストリーミング中のテキストを蓄積しつつ、クライアントにも送信
            node_id = event.get("node_id")
            stream_event = event.get("event")

            # stream_eventからテキストを抽出
            if isinstance(stream_event, dict) and "data" in stream_event:
                text = stream_event["data"]
                if node_id and node_id in node_contents:
                    node_contents[node_id] += text
                    # 逐次レンダリング用にストリーミングイベントを送信
                    yield json.dumps(
                        {"event": "node_stream", "node_id": node_id, "text": text}
                    )

        elif event_type == "multiagent_node_stop":
            node_id = event["node_id"]
            content = node_contents.get(node_id, "")
            yield json.dumps(
                {"event": "node_stop", "node_id": node_id, "content": content}
            )

        elif event_type == "multiagent_result":
            yield json.dumps(
                {"event": "complete", "status": str(event["result"].status)}
            )


if __name__ == "__main__":
    app.run()
