'use client';

import { BookOpenIcon, SparklesIcon, Volume2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { DictionaryEntry } from '@gloaming/shared/dictionary';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ReaderDictionaryCardProps = {
  word: string;
  entry: DictionaryEntry | null | undefined;
  isLoading: boolean;
  contextSentence?: string;
  onAskAi: (word: string, contextSentence?: string) => void;
  onClose: () => void;
  className?: string;
};

export function ReaderDictionaryCard({
  word,
  entry,
  isLoading,
  contextSentence,
  onAskAi,
  onClose,
  className,
}: ReaderDictionaryCardProps) {
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  function handlePlayAudio(audioUrl?: string) {
    if (!audioUrl) {
      toast.info('暂无该发音音频');
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    setPlayingAudioUrl(audioUrl);
    audio.onended = () => setPlayingAudioUrl(null);
    audio.onerror = () => {
      setPlayingAudioUrl(null);
      toast.error('音频播放失败');
    };
    audio.play().catch(() => setPlayingAudioUrl(null));
  }

  // Find US and UK phonetics
  const phonetics = entry?.phonetics || [];
  const usPhonetic =
    phonetics.find((p) => p.role === 'us') || phonetics.find((p) => p.text?.includes('US') || p.audio?.includes('-us'));
  const ukPhonetic =
    phonetics.find((p) => p.role === 'uk') || phonetics.find((p) => p.text?.includes('UK') || p.audio?.includes('-uk'));
  const fallbackPhonetic = phonetics[0];

  const primaryPhonetic = usPhonetic || fallbackPhonetic;
  const secondaryPhonetic = ukPhonetic && ukPhonetic !== usPhonetic ? ukPhonetic : null;

  const contextExample = entry?.contextExamples?.[0];

  return (
    <div className={cn('flex flex-col text-sm text-foreground', className)}>
      {/* Header with Word and Phonetics */}
      <div className="flex items-start justify-between gap-3 border-b border-border/50 pb-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-serif text-xl font-bold tracking-tight text-foreground">
            {entry?.word || word}
          </h3>

          {isLoading ? (
            <div className="mt-1.5 flex gap-2">
              <div className="h-4 w-24 animate-pulse rounded bg-surface-container-high" />
            </div>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {primaryPhonetic && (
                <button
                  type="button"
                  onClick={() => handlePlayAudio(primaryPhonetic.audio)}
                  disabled={!primaryPhonetic.audio}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs transition-colors',
                    primaryPhonetic.audio
                      ? 'cursor-pointer bg-surface-container-high/70 hover:bg-surface-container-highest hover:text-primary'
                      : 'bg-surface-container/50 text-muted-foreground',
                    playingAudioUrl === primaryPhonetic.audio && 'bg-primary/10 text-primary ring-1 ring-primary/40',
                  )}
                  title={primaryPhonetic.audio ? '点击朗读发音' : undefined}
                >
                  <Volume2Icon
                    className={cn(
                      'size-3.5 shrink-0',
                      playingAudioUrl === primaryPhonetic.audio && 'animate-pulse text-primary',
                    )}
                  />
                  <span className="font-medium">{primaryPhonetic.role === 'uk' ? '英' : '美'}</span>
                  {primaryPhonetic.text && (
                    <span className="font-sans text-muted-foreground">{primaryPhonetic.text}</span>
                  )}
                </button>
              )}

              {secondaryPhonetic && (
                <button
                  type="button"
                  onClick={() => handlePlayAudio(secondaryPhonetic.audio)}
                  disabled={!secondaryPhonetic.audio}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs transition-colors',
                    secondaryPhonetic.audio
                      ? 'cursor-pointer bg-surface-container-high/70 hover:bg-surface-container-highest hover:text-primary'
                      : 'bg-surface-container/50 text-muted-foreground',
                    playingAudioUrl === secondaryPhonetic.audio && 'bg-primary/10 text-primary ring-1 ring-primary/40',
                  )}
                  title={secondaryPhonetic.audio ? '点击朗读发音' : undefined}
                >
                  <Volume2Icon
                    className={cn(
                      'size-3.5 shrink-0',
                      playingAudioUrl === secondaryPhonetic.audio && 'animate-pulse text-primary',
                    )}
                  />
                  <span className="font-medium">英</span>
                  {secondaryPhonetic.text && (
                    <span className="font-sans text-muted-foreground">{secondaryPhonetic.text}</span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content Body */}
      <div className="flex-1 space-y-4 overflow-y-auto py-3">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-4 w-12 animate-pulse rounded bg-surface-container-high" />
            <div className="space-y-2">
              <div className="h-4 w-5/6 animate-pulse rounded bg-surface-container-high" />
              <div className="h-4 w-4/6 animate-pulse rounded bg-surface-container-high" />
            </div>
            <div className="mt-4 h-16 w-full animate-pulse rounded-xl bg-surface-container-low" />
          </div>
        ) : entry && entry.meanings.length > 0 ? (
          <div className="space-y-3.5">
            {/* Meanings */}
            {entry.meanings.map((meaning, mIdx) => (
              <div key={mIdx} className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="border-primary/30 bg-primary/5 px-1.5 py-0 font-mono text-[11px] font-semibold text-primary"
                  >
                    {meaning.partOfSpeech}
                  </Badge>
                </div>

                <div className="space-y-1.5 pl-1">
                  {meaning.definitions.map((def, dIdx) => (
                    <div key={dIdx} className="text-xs leading-relaxed">
                      {def.definitionZh ? (
                        <p className="font-medium text-foreground">
                          {meaning.definitions.length > 1 && (
                            <span className="mr-1 text-muted-foreground">{dIdx + 1}.</span>
                          )}
                          {def.definitionZh}
                        </p>
                      ) : null}
                      <p
                        className={cn(
                          'text-muted-foreground',
                          def.definitionZh ? 'mt-0.5 text-[11px]' : 'font-medium text-foreground text-xs',
                        )}
                      >
                        {!def.definitionZh && meaning.definitions.length > 1 && (
                          <span className="mr-1 text-muted-foreground">{dIdx + 1}.</span>
                        )}
                        {def.definition}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Context Enrichment from Current Book */}
            {contextExample && (contextExample.sentence || contextExample.note) && (
              <div className="mt-3 rounded-xl border border-primary/20 bg-surface-container-low/70 p-3 shadow-xs">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <SparklesIcon className="size-3.5 shrink-0" />
                  <span>本书语境解读</span>
                </div>
                {contextExample.sentence && (
                  <p className="mt-1.5 font-heading text-xs italic text-foreground/90">“{contextExample.sentence}”</p>
                )}
                {contextExample.sentenceZh && (
                  <p className="mt-1 text-xs text-muted-foreground">译文：{contextExample.sentenceZh}</p>
                )}
                {contextExample.note && (
                  <div className="mt-2 rounded-lg bg-surface-container-high/50 p-2 text-xs leading-relaxed text-foreground/90">
                    {contextExample.note}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <BookOpenIcon className="size-8 text-muted-foreground/50" />
            <p className="mt-2 text-xs font-medium text-foreground/80">未在基础词典中找到该词释义</p>
            <p className="mt-1 text-[11px] text-muted-foreground">您可以让 AI 助手直接为您深入讲解。</p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-3">
        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg text-xs" onClick={onClose}>
          关闭
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-lg text-xs hover:bg-brand-deep"
          onClick={() => onAskAi(word, contextSentence)}
        >
          <SparklesIcon className="mr-1 size-3" />问 AI 深入讲解
        </Button>
      </div>
    </div>
  );
}
