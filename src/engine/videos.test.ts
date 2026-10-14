import { describe, expect, it } from 'vitest';
import { EXERCISES } from './exercises';
import { EXERCISE_VIDEOS, videoFor, youtubeId } from './videos';

describe('exercise videos', () => {
  it('only covers real exercises, with well-formed ids', () => {
    const ids = new Set(EXERCISES.map((e) => e.id));
    for (const [exerciseId, video] of Object.entries(EXERCISE_VIDEOS)) {
      expect(ids.has(exerciseId), exerciseId).toBe(true);
      expect(video, exerciseId).toMatch(/^[\w-]{11}$/);
    }
  });

  it('reads the id from any kind of YouTube link', () => {
    const id = 'ultWZbUMPL8';
    for (const link of [
      id,
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=42s`,
      `https://m.youtube.com/watch?feature=share&v=${id}`,
      `https://youtu.be/${id}?si=abc`,
      `youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}?start=10`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
    ]) {
      expect(youtubeId(link), link).toBe(id);
    }
    for (const bad of ['', 'not a link', 'https://vimeo.com/123456', 'https://www.youtube.com/watch?v=short', 'https://example.com/watch?v=ultWZbUMPL8']) {
      expect(youtubeId(bad), bad).toBeUndefined();
    }
  });

  it("prefers the lifter's own video", () => {
    expect(videoFor('no-such-exercise')).toBeUndefined();
    expect(videoFor('no-such-exercise', { video: 'ultWZbUMPL8' })).toBe('ultWZbUMPL8');
  });
});
