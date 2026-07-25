import { NextRequest } from "next/server";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { buildSystemPrompt, getCharacterById } from "@/lib/characters";

export const runtime = "nodejs";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function POST(request: NextRequest) {
  try {
    const { messages, characterId } = await request.json();

    if (!characterId) {
      return new Response(JSON.stringify({ error: "缺少角色ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const character = getCharacterById(characterId);
    if (!character) {
      return new Response(JSON.stringify({ error: "角色不存在" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    // 构建消息：系统提示 + 历史消息
    const systemPrompt = buildSystemPrompt(character);
    const chatMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages.slice(-20), // 只保留最近20条，节省token
    ];

    const stream = client.stream(chatMessages, {
      model: "doubao-seed-2-0-lite-260215",
      temperature: 0.9,
    });

    // 创建SSE流式响应
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.content) {
              const text = chunk.content.toString();
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (err) {
          console.error("Streaming error:", err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "生成失败" })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(JSON.stringify({ error: "服务器错误" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
