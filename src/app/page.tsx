"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { characters, type Character, shouldGeneratePhoto } from "@/lib/characters";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  audioUri?: string;
  imageUrl?: string;
  isLoading?: boolean;
}

type View = "select" | "chat";

export default function Home() {
  const [view, setView] = useState<View>("select");
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [photoTriggerCount, setPhotoTriggerCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 选择角色
  const selectCharacter = (character: Character) => {
    setSelectedCharacter(character);
    setView("chat");
    setMessages([]);
    setReferenceImage(null);
    setPhotoTriggerCount(0);
    setMessageCount(0);

    // 延迟发送开场消息
    setTimeout(() => {
      const greetingMsg: Message = {
        id: `greeting-${Date.now()}`,
        role: "assistant",
        content: character.greeting,
      };
      setMessages([greetingMsg]);
      setMessageCount(1);
    }, 500);
  };

  // 返回角色选择
  const backToSelect = () => {
    setView("select");
    setSelectedCharacter(null);
    setMessages([]);
    setReferenceImage(null);
    setPhotoTriggerCount(0);
    setMessageCount(0);
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
  };

  // 生成图片
  const generateImage = useCallback(
    async (scene?: string, chatContext?: string): Promise<string | null> => {
      if (!selectedCharacter) return null;
      try {
        const response = await fetch("/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            characterId: selectedCharacter.id,
            scene,
            chatContext,
          }),
        });
        const data = await response.json();
        if (data.imageUrl) {
          if (!referenceImage) {
            setReferenceImage(data.imageUrl);
          }
          return data.imageUrl;
        }
        return null;
      } catch (err) {
        console.error("Generate image error:", err);
        return null;
      }
    },
    [selectedCharacter, referenceImage]
  );

  // 根据角色生成照片配文
  const getPhotoCaption = (characterId: string): string => {
    const captions: Record<string, string[]> = {
      xiaotian: [
        "刚拍的，给你看看～",
        "今天长这样😝",
        "嘻嘻，突然想发自拍",
        "觉得好看就给你发啦～",
        "喏，新鲜出炉的自拍✨",
      ],
      linjie: [
        "刚随手拍了一张",
        "嗯…给你看看吧",
        "今天的状态还不错",
        "在想你，顺便拍了张",
        "难得自拍，便宜你了",
      ],
      xiaoxue: [
        "哼、才、才不是特意拍给你的！",
        "刚好拍到而已…",
        "你、你不准笑哦！",
        "勉勉强强给你看一下啦",
        "才不是因为想你才拍的！",
      ],
    };
    const list = captions[characterId] || captions.xiaotian;
    return list[Math.floor(Math.random() * list.length)];
  };

  // 发送消息
  const sendMessage = async () => {
    if (!inputValue.trim() || isTyping || !selectedCharacter) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: inputValue.trim(),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInputValue("");
    setIsTyping(true);
    setMessageCount((prev) => prev + 1);

    // 重置空闲计时器
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    try {
      // 检查是否触发生图
      const needPhoto = shouldGeneratePhoto(userMsg.content, photoTriggerCount);
      // 或者每聊15-20轮随机主动发一张
      const randomPhoto =
        messageCount > 0 && messageCount % 15 === 0 && Math.random() > 0.5;
      const shouldSendPhoto = needPhoto || randomPhoto;

      // 流式获取AI回复
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          characterId: selectedCharacter.id,
        }),
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No reader");
      }

      const decoder = new TextDecoder();
      let aiContent = "";
      const aiMsgId = `ai-${Date.now()}`;

      setMessages((prev) => [
        ...prev,
        { id: aiMsgId, role: "assistant", content: "", isLoading: true },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                aiContent += data.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMsgId
                      ? { ...m, content: aiContent, isLoading: false }
                      : m
                  )
                );
              }
              if (data.done) {
                setIsTyping(false);

                // 后台生成语音
                generateTTS(aiMsgId, aiContent);

                // 如果需要发照片
                if (shouldSendPhoto) {
                  setPhotoTriggerCount((prev) => prev + 1);
                  // 获取最近几条聊天内容作为上下文
                  const recentContext = newMessages
                    .slice(-5)
                    .map((m) => m.content)
                    .join(" ");
                  // 延迟一会儿再发照片，像真人拍完照发过来
                  setTimeout(async () => {
                    setIsTyping(true);
                    const imgUrl = await generateImage(undefined, recentContext);
                    setIsTyping(false);
                    if (imgUrl) {
                      // 先发一句配文
                      const captionMsg: Message = {
                        id: `caption-${Date.now()}`,
                        role: "assistant",
                        content: getPhotoCaption(selectedCharacter.id),
                      };
                      setMessages((prev) => [...prev, captionMsg]);
                      // 再发照片
                      setTimeout(() => {
                        const photoMsg: Message = {
                          id: `photo-${Date.now()}`,
                          role: "assistant",
                          content: "",
                          imageUrl: imgUrl,
                        };
                        setMessages((prev) => [...prev, photoMsg]);
                      }, 800);
                    }
                  }, 2000);
                }

                // 检查是否冷场（用户回复太短）
                if (userMsg.content.length <= 2) {
                  // 下一轮AI主动换话题，已经在LLM回复中处理了
                }

                // 设置空闲计时器（60秒没说话就发试探消息）
                idleTimerRef.current = setTimeout(() => {
                  sendNudgeMessage();
                }, 60000);
              }
              if (data.error) {
                setIsTyping(false);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMsgId
                      ? { ...m, content: "抱歉，我有点累了，歇会儿再说吧～", isLoading: false }
                      : m
                  )
                );
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error) {
      console.error("Send message error:", error);
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "网络不太好，再说一遍好吗？",
        },
      ]);
    }
  };

  // 生成TTS语音
  const generateTTS = async (msgId: string, text: string) => {
    if (!selectedCharacter) return;
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          characterId: selectedCharacter.id,
          uid: msgId,
        }),
      });
      const data = await response.json();
      if (data.audioUri) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, audioUri: data.audioUri } : m
          )
        );
      }
    } catch (err) {
      console.error("TTS error:", err);
    }
  };

  // 播放语音
  const playAudio = (audioUri: string, msgId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }

    if (playingId === msgId) {
      setPlayingId(null);
      return;
    }

    const audio = new Audio(audioUri);
    audioRef.current = audio;
    setPlayingId(msgId);

    audio.onended = () => {
      setPlayingId(null);
      audioRef.current = null;
    };

    audio.onerror = () => {
      setPlayingId(null);
      audioRef.current = null;
    };

    audio.play().catch(() => {
      setPlayingId(null);
    });
  };

  // 空闲试探消息
  const sendNudgeMessage = async () => {
    if (!selectedCharacter || isTyping) return;

    const nudges = [
      "人呢？是不是又跑去摸鱼了🐟",
      "怎么不说话啦～在干嘛呢",
      "喂喂喂，还在吗？",
      "你不理我，我可要生气了哦😤",
      "在忙吗？那我等你会儿～",
    ];

    const nudge = nudges[Math.floor(Math.random() * nudges.length)];
    const nudgeMsg: Message = {
      id: `nudge-${Date.now()}`,
      role: "assistant",
      content: nudge,
    };

    setMessages((prev) => [...prev, nudgeMsg]);
    setMessageCount((prev) => prev + 1);

    // 生成语音
    generateTTS(nudgeMsg.id, nudge);
  };

  // 键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // 角色选择页
  if (view === "select") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[oklch(0.97_0.03_85)] via-[oklch(0.98_0.02_75)] to-[oklch(0.96_0.03_80)] relative overflow-hidden">
        {/* 背景装饰光斑 */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[oklch(0.85_0.1_30)] rounded-full blur-[120px] opacity-20 pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-[oklch(0.88_0.12_50)] rounded-full blur-[100px] opacity-15 pointer-events-none" />
        <div className="absolute top-1/3 right-0 w-72 h-72 bg-[oklch(0.9_0.08_65)] rounded-full blur-[90px] opacity-20 pointer-events-none" />

        <div className="relative max-w-3xl mx-auto px-4 py-16 md:py-20">
          {/* 标题区 */}
          <div className="text-center mb-12 md:mb-14">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/60 backdrop-blur-sm rounded-full text-sm text-[oklch(0.55_0.1_25)] mb-5 shadow-sm border border-white/80">
              <span className="text-base">💗</span>
              <span>AI 虚拟陪伴</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-3 tracking-tight bg-gradient-to-r from-[oklch(0.78_0.18_0)] via-[oklch(0.7_0.22_350)] to-[oklch(0.72_0.2_20)] bg-clip-text text-transparent">
              选择你的心动女生
            </h1>
            <p className="text-[oklch(0.55_0.03_60)] text-sm md:text-base max-w-sm mx-auto leading-relaxed">
              每个人都有独特的性格和故事，<br className="md:hidden" />选一个喜欢的，开始你们的故事吧～
            </p>
          </div>

          {/* 角色卡片 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 md:gap-7">
            {characters.map((char: Character, idx: number) => (
              <div
                key={char.id}
                onClick={() => selectCharacter(char)}
                className="group relative bg-white rounded-3xl shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer overflow-hidden border border-white hover:-translate-y-2 card-shine"
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                {/* 头像区 */}
                <div className="aspect-[4/5] bg-gradient-to-b from-[oklch(0.94_0.04_75)] to-[oklch(0.92_0.05_60)] overflow-hidden relative">
                  <img
                    src={char.avatar}
                    alt={char.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                    loading="lazy"
                  />
                  {/* 渐变遮罩 */}
                  <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  
                  {/* 在线标识 */}
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/30 backdrop-blur-md px-2.5 py-1 rounded-full">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    <span className="text-white text-xs font-medium">在线</span>
                  </div>

                  {/* 底部信息 */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                    <div className="flex items-end justify-between mb-1.5">
                      <div>
                        <h3 className="text-xl font-bold tracking-wide">{char.name}</h3>
                        <p className="text-white/80 text-xs mt-0.5">{char.age}岁 · {char.traits[0]}</p>
                      </div>
                      <div className="text-2xl heart-beat">💗</div>
                    </div>
                    {/* 一句话slogan */}
                    <p className="text-sm text-white/90 line-clamp-2 leading-snug">
                      {char.slogan || char.personality.slice(0, 25)}
                    </p>
                  </div>
                </div>

                {/* 卡片底部标签 + 按钮 */}
                <div className="p-4">
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {char.traits.slice(0, 3).map((trait: string) => (
                      <span
                        key={trait}
                        className="text-xs px-2.5 py-1 bg-[oklch(0.95_0.03_80)] text-[oklch(0.55_0.1_25)] rounded-full font-medium"
                      >
                        #{trait}
                      </span>
                    ))}
                  </div>
                  <button className="w-full py-2.5 bg-gradient-to-r from-[oklch(0.78_0.16_30)] to-[oklch(0.72_0.18_20)] text-white rounded-2xl text-sm font-semibold opacity-90 group-hover:opacity-100 group-hover:shadow-lg transition-all duration-300 active:scale-[0.98]">
                    开始聊天
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 底部提示 */}
          <div className="text-center mt-10">
            <p className="text-xs text-[oklch(0.55_0.02_70)] opacity-70">
              ⚠️ 这是AI虚拟角色生成内容，仅供娱乐陪伴使用
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 聊天页
  return (
    <div className="flex flex-col h-screen bg-[oklch(0.94_0.02_80)] relative overflow-hidden">
      {/* 聊天背景纹理 */}
      <div 
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 30%, oklch(0.9_0.05_60 / 0.3) 0%, transparent 50%),
                           radial-gradient(circle at 80% 70%, oklch(0.92_0.04_40 / 0.3) 0%, transparent 50%)`,
        }}
      />

      {/* 顶部导航栏 - 微信风格 */}
      <div className="bg-[oklch(0.97_0.015_85)] border-b border-[oklch(0.9_0.02_75)] px-3 py-2.5 flex items-center relative z-10 shadow-sm">
        {/* 返回按钮 */}
        <div className="w-14 flex items-center">
          <button
            onClick={backToSelect}
            className="text-[oklch(0.45_0.03_50)] hover:text-[oklch(0.3_0.04_40)] px-2 py-1 -ml-2 rounded-lg hover:bg-black/5 transition-colors flex items-center gap-1 text-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">返回</span>
          </button>
        </div>

        {/* 中间：头像 + 名字 + 状态 */}
        <div className="flex-1 flex items-center justify-center gap-2.5">
          <div className="relative">
            <img
              src={selectedCharacter?.avatar}
              alt={selectedCharacter?.name}
              className="w-9 h-9 rounded-full object-cover ring-2 ring-white shadow-sm"
            />
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[oklch(0.97_0.015_85)]" />
          </div>
          <div className="text-center">
            <div className="font-semibold text-[oklch(0.25_0.03_50)] text-sm -mb-0.5">
              {selectedCharacter?.name}
            </div>
            <div className="text-[11px] text-green-600 font-medium">
              {isTyping ? "对方正在输入..." : "在线"}
            </div>
          </div>
        </div>

        <div className="w-14 flex justify-end">
          <button className="text-[oklch(0.5_0.02_60)] hover:text-[oklch(0.35_0.03_50)] p-1.5 rounded-lg hover:bg-black/5 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4 relative z-0">
        {/* 时间分割线 */}
        <div className="text-center">
          <span className="text-xs text-[oklch(0.55_0.02_70)] bg-[oklch(0.92_0.02_75)]/70 backdrop-blur-sm px-3 py-1 rounded-full">
            今天
          </span>
        </div>

        {/* AI提示条 */}
        <div className="text-center">
          <span className="text-xs text-[oklch(0.5_0.02_70)] bg-white/60 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-white/80">
            以下为AI虚拟角色生成内容，仅供娱乐
          </span>
        </div>

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} msg-rise`}
          >
            {msg.role === "assistant" && (
              <img
                src={selectedCharacter?.avatar}
                alt={selectedCharacter?.name}
                className="w-9 h-9 rounded-full object-cover mr-2.5 flex-shrink-0 mt-0.5 ring-1 ring-white shadow-sm"
              />
            )}

            <div
              className={`max-w-[72%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1.5`}
            >
              {/* 图片消息 */}
              {msg.imageUrl && (
                <div
                  onClick={() => setViewerImage(msg.imageUrl as string)}
                  className={`relative rounded-2xl overflow-hidden cursor-zoom-in shadow-md hover:shadow-lg transition-shadow ${
                    msg.role === "user" ? "bg-[oklch(0.82_0.14_95)]" : "bg-white"
                  }`}
                >
                  {msg.isLoading ? (
                    <div className="w-52 h-64 skeleton rounded-2xl flex items-center justify-center">
                      <div className="text-center">
                        <div className="w-8 h-8 border-2 border-[oklch(0.75_0.08_50)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-xs text-[oklch(0.55_0.05_50)]">照片生成中...</p>
                      </div>
                    </div>
                  ) : (
                    <img
                      src={msg.imageUrl}
                      alt="photo"
                      className="max-w-[220px] max-h-[280px] rounded-2xl object-cover img-fade-in"
                      loading="lazy"
                    />
                  )}
                </div>
              )}

              {/* 文字消息 */}
              {msg.content && (
                <div className="flex items-end gap-1 max-w-full">
                  {msg.role === "assistant" && msg.audioUri && (
                    <button
                      onClick={() => playAudio(msg.audioUri as string, msg.id)}
                      className={`p-2 rounded-full hover:bg-black/5 transition-colors flex-shrink-0 ${
                        playingId === msg.id ? "text-[oklch(0.65_0.18_25)]" : "text-[oklch(0.55_0.02_70)]"
                      }`}
                      title="播放语音"
                    >
                      {playingId === msg.id ? (
                        <div className="flex items-end gap-0.5 h-4">
                          <span className="w-0.5 h-2 bg-current rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
                          <span className="w-0.5 h-4 bg-current rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                          <span className="w-0.5 h-2.5 bg-current rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
                        </div>
                      ) : (
                        <svg className="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                        </svg>
                      )}
                    </button>
                  )}
                  <div
                    className={`relative px-3.5 py-2.5 text-sm leading-relaxed break-words ${
                      msg.role === "user"
                        ? "bg-[oklch(0.82_0.14_95)] text-[oklch(0.25_0.03_50)] rounded-2xl rounded-tr-md bubble-tail-right"
                        : "bg-white text-[oklch(0.25_0.03_50)] rounded-2xl rounded-tl-md shadow-sm bubble-tail-left"
                    } ${msg.isLoading ? "opacity-60" : ""}`}
                  >
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                    {msg.isLoading && (
                      <span className="inline-block w-0.5 h-4 bg-[oklch(0.6_0.05_50)] ml-1 animate-pulse align-middle" />
                    )}
                  </div>
                </div>
              )}
            </div>

            {msg.role === "user" && (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[oklch(0.75_0.08_60)] to-[oklch(0.7_0.1_45)] flex items-center justify-center text-xs text-white font-medium ml-2.5 flex-shrink-0 mt-0.5 shadow-sm">
                我
              </div>
            )}
          </div>
        ))}

        {/* 正在输入提示 */}
        {isTyping && (
          <div className="flex justify-start msg-rise">
            <img
              src={selectedCharacter?.avatar}
              alt={selectedCharacter?.name}
              className="w-9 h-9 rounded-full object-cover mr-2.5 flex-shrink-0 ring-1 ring-white shadow-sm"
            />
            <div className="bg-white px-4 py-3 rounded-2xl rounded-tl-md shadow-sm relative bubble-tail-left">
              <div className="flex gap-1 items-end">
                <span className="w-2 h-2 bg-[oklch(0.7_0.04_60)] rounded-full" style={{ animation: "bounce 1s infinite", animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-[oklch(0.7_0.04_60)] rounded-full" style={{ animation: "bounce 1s infinite", animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-[oklch(0.7_0.04_60)] rounded-full" style={{ animation: "bounce 1s infinite", animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="bg-[oklch(0.97_0.015_85)] border-t border-[oklch(0.9_0.02_75)] px-3 py-2.5 relative z-10">
        <div className="flex items-end gap-2">
          <button className="p-2 text-[oklch(0.5_0.02_70)] hover:text-[oklch(0.35_0.03_50)] hover:bg-black/5 rounded-xl transition-colors flex-shrink-0">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="说点什么..."
              disabled={isTyping}
              className="w-full bg-white border border-[oklch(0.88_0.02_75)] rounded-2xl px-4 py-2.5 text-sm text-[oklch(0.25_0.03_50)] placeholder:text-[oklch(0.55_0.02_70)] focus:outline-none focus:border-[oklch(0.75_0.1_45)] focus:ring-2 focus:ring-[oklch(0.75_0.1_45)]/20 transition-all disabled:bg-[oklch(0.95_0.015_85)]"
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={isTyping || !inputValue.trim()}
            className="px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200 active:scale-[0.96] flex-shrink-0 bg-gradient-to-r from-[oklch(0.78_0.16_30)] to-[oklch(0.72_0.18_20)] text-white shadow-md hover:shadow-lg disabled:from-[oklch(0.85_0.03_70)] disabled:to-[oklch(0.85_0.03_70)] disabled:text-white/70 disabled:shadow-none disabled:cursor-not-allowed"
          >
            发送
          </button>
        </div>
      </div>

      {/* 图片查看器 */}
      {viewerImage && (
        <div
          className="fixed inset-0 z-50 image-viewer-backdrop bg-black/80 flex items-center justify-center p-4"
          onClick={() => setViewerImage(null)}
        >
          <button
            className="absolute top-5 right-5 text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
            onClick={() => setViewerImage(null)}
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={viewerImage}
            alt="viewer"
            className="max-w-full max-h-full rounded-xl shadow-2xl img-fade-in"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
