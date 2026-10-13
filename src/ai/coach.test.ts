import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { runTurn } from './coach';

function sse(events: object[]): Response {
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const start = (id: string) => ({
  type: 'message_start',
  message: { id, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } },
});

beforeAll(async () => {
  await db.gyms.put({ id: 'g1', name: 'Home', equipment: ['dumbbells', 'bench', 'pullup_bar'] });
  await db.profile.put({
    id: 'me', name: 'Pat', units: 'kg', bodyweightKg: 80, sex: 'unspecified', experience: 'intermediate', goal: 'hypertrophy',
    daysPerWeek: 3, sessionMinutes: 45, activeGymId: 'g1', onboarded: true, createdAt: 0,
  });
});

describe('coach turn loop', () => {
  it('runs build_workout locally, returns the result to Claude, and streams the reply', async () => {
    const bodies: Record<string, unknown>[] = [];
    let call = 0;
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      call++;
      if (call === 1) {
        return sse([
          start('m1'),
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'build_workout', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"focus":"upper","minutes":30,"avoid_muscles":["lower_back"],"gym":""}' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
          { type: 'message_stop' },
        ]);
      }
      return sse([
        start('m2'),
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Built you a 30-minute ' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'upper session.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } },
        { type: 'message_stop' },
      ]);
    }) as typeof fetch;

    const seen: string[] = [];
    const result = await runTurn({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
      history: [],
      userText: '30 min upper please, my lower back is tight',
      onText: (t) => seen.push(t),
      fetch: fakeFetch,
    });

    expect(result.text).toBe('Built you a 30-minute upper session.');
    expect(seen.at(-1)).toBe(result.text);
    expect(result.workoutId).toBeDefined();
    const plan = await db.workouts.get(result.workoutId!);
    expect(plan?.status).toBe('planned');
    expect(plan?.exercises.length).toBeGreaterThan(1);

    // First request: user turn followed by the live training snapshot as a system message.
    const first = bodies[0] as { messages: { role: string; content: unknown }[]; system: string; fallbacks: string };
    expect(first.messages.map((m) => m.role)).toEqual(['user', 'system']);
    expect(String(first.messages[1]!.content)).toContain('<training_snapshot>');
    expect(first.fallbacks).toBe('default');
    // Second request replays the first verbatim and appends the tool result.
    const second = bodies[1] as { messages: { role: string; content: { type: string; content?: string }[] }[]; system: string };
    expect(second.system).toBe(first.system);
    expect(second.messages.slice(0, 2)).toEqual(first.messages);
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'system', 'assistant', 'user']);
    const toolResult = second.messages[3]!.content[0]!;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.content).toContain('Saved "Upper body');
    // Transcript to store: everything appended this turn, in order.
    expect(result.appended.map((m) => m.role)).toEqual(['user', 'system', 'assistant', 'user', 'assistant']);
  });
});
