import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { rootLogger } from '@/lib/logger';

const azureTtsLogger = rootLogger.child({ module: 'AzureTts' });

export type AzureTtsWordTiming = {
  text: string;
  audioOffsetMs: number;
  durationMs: number;
  textOffset: number;
};

export type AzureTtsSynthesizeInput = {
  subscriptionKey: string;
  region: string;
  voice: string;
  text: string;
};

export type AzureTtsSynthesizeResult = {
  audio: Buffer;
  mimeType: string;
  wordTimings: AzureTtsWordTiming[];
};

/**
 * Low-level Azure Speech SDK adapter. Callers pass credentials explicitly — no DB access.
 */
export async function synthesizeAzureTts(input: AzureTtsSynthesizeInput): Promise<AzureTtsSynthesizeResult> {
  const speechConfig = sdk.SpeechConfig.fromSubscription(input.subscriptionKey, input.region);
  speechConfig.speechSynthesisVoiceName = input.voice;
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, undefined);
  const wordTimings: AzureTtsWordTiming[] = [];

  synthesizer.wordBoundary = (_sender, event) => {
    // Azure ticks are 100ns; division can yield fractional ms — API/Zod expect ints.
    wordTimings.push({
      text: event.text,
      audioOffsetMs: Math.round(event.audioOffset / 10_000),
      durationMs: Math.round(event.duration / 10_000),
      textOffset: event.textOffset,
    });
  };

  try {
    const result = await new Promise<sdk.SpeechSynthesisResult>((resolve, reject) => {
      synthesizer.speakTextAsync(
        input.text,
        (synthesisResult) => resolve(synthesisResult),
        (error) => reject(new Error(typeof error === 'string' ? error : String(error))),
      );
    });

    if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
      return {
        audio: Buffer.from(result.audioData),
        mimeType: 'audio/mpeg',
        wordTimings,
      };
    }

    const details = sdk.CancellationDetails.fromResult(result);
    const vendorMessage = details.errorDetails?.trim() || details.reason.toString() || 'TTS synthesis failed';
    azureTtsLogger.warn({ vendorMessage, reason: details.reason }, 'Azure TTS synthesis failed');
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.TTS.SYNTHESIS_FAILED);
  } finally {
    synthesizer.close();
  }
}
