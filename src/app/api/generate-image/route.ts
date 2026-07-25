import { NextRequest, NextResponse } from "next/server";
import { ImageGenerationClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { characters, buildImagePrompt, getRandomPhotoScene } from "@/lib/characters";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { characterId, scene, chatContext } = (await request.json()) as {
      characterId: string;
      scene?: string;
      chatContext?: string;
    };
    const character = characters.find((c) => c.id === characterId);

    if (!character) {
      return NextResponse.json({ error: "角色不存在" }, { status: 400 });
    }

    // 如果传了场景就用传的，否则根据上下文智能选一个
    let sceneInfo;
    if (scene) {
      sceneInfo = {
        keyword: "custom",
        scene: scene,
        outfit: "休闲装",
        pose: "自然微笑自拍",
        mood: "自然光线",
      };
    } else {
      sceneInfo = getRandomPhotoScene(characterId, chatContext || "");
    }

    const fullPrompt = buildImagePrompt(character, sceneInfo);

    // 使用角色头像作为参考图（图生图，保持角色一致性）
    const referenceImage = character.avatar;

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new ImageGenerationClient(config, customHeaders);

    const response = await client.generate({
      model: "doubao-seedream-5-0-260128",
      prompt: fullPrompt,
      size: "1024x1024",
      image: referenceImage,
    });

    const helper = client.getResponseHelper(response);

    if (helper.success && helper.imageUrls.length > 0) {
      return NextResponse.json({
        imageUrl: helper.imageUrls[0],
        prompt: fullPrompt,
        sceneInfo,
      });
    } else {
      return NextResponse.json(
        { error: helper.errorMessages.join(", ") || "图片生成失败" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("生成图片失败:", error);
    return NextResponse.json({ error: "图片生成失败" }, { status: 500 });
  }
}
