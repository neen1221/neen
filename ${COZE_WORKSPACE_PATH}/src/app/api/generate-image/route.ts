import { NextRequest, NextResponse } from "next/server";
import { ImageGenerationClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getCharacterById } from "@/lib/characters";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { characterId, referenceImage, scene } = await request.json();

    if (!characterId) {
      return NextResponse.json({ error: "缺少角色ID" }, { status: 400 });
    }

    const character = getCharacterById(characterId);
    if (!character) {
      return NextResponse.json({ error: "角色不存在" }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new ImageGenerationClient(config, customHeaders);

    // 构建prompt：基础外貌 + 场景描述
    let prompt = character.imagePrompt;
    if (scene) {
      prompt += `，${scene}`;
    }
    // 加上自拍风格
    prompt += "，自拍角度，自然光线，真实感照片风格";

    const requestOptions: {
      prompt: string;
      size: string;
      image?: string;
      watermark: boolean;
    } = {
      prompt,
      size: "1024x1024",
      watermark: false,
    };

    // 如果有参考图，用图生图保持角色一致性
    if (referenceImage) {
      requestOptions.image = referenceImage;
    }

    const response = await client.generate(requestOptions);
    const helper = client.getResponseHelper(response);

    if (helper.success && helper.imageUrls.length > 0) {
      return NextResponse.json({
        imageUrl: helper.imageUrls[0],
      });
    } else {
      return NextResponse.json(
        { error: helper.errorMessages.join(", ") || "图片生成失败" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Image generation API error:", error);
    return NextResponse.json({ error: "图片生成失败" }, { status: 500 });
  }
}
