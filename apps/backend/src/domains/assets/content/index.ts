/** Content-asset domain capabilities: admin read models, learner published audio, availability, object lifecycle. */
export { deleteAudioAssetObjects } from '@/domains/assets/content/audio/object-lifecycle';
export type { PartAudioAvailability } from '@/domains/assets/content/availability';
export { getPartAudioAvailability, needsRegen } from '@/domains/assets/content/availability';
export { getPublishedPartAudioTrack } from '@/domains/assets/content/published';
export { getPartAudio, getWorkAudio } from '@/domains/assets/content/read-model';
