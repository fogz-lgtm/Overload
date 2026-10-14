import { useEffect, useMemo, useState } from 'react';
import { loadGenerateInput } from '../db/repo';
import { isAvailable, planExercise, swapOptions, type GenerateInput } from '../engine/generator';
import { MUSCLES, MUSCLE_IDS } from '../engine/muscles';
import type { Exercise, MuscleId, WorkoutExercise } from '../engine/types';
import { MuscleThumb } from './BodyMap';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

function useGenerateInput(open: boolean) {
  const [input, setInput] = useState<GenerateInput | null>(null);
  useEffect(() => {
    if (open) void loadGenerateInput().then(setInput);
  }, [open]);
  return input;
}

export function ExerciseRow({ ex, trailing, onClick, disabled }: { ex: Exercise; trailing?: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="list-item" onClick={onClick} disabled={disabled}>
      <MuscleThumb primary={ex.primary} secondary={ex.secondary} size={44} />
      <span className="grow">
        <span style={{ display: 'block', fontWeight: 620 }}>{ex.name}</span>
        <span className="small faint">{ex.primary.map((m) => MUSCLES[m].name).join(', ')}</span>
      </span>
      {trailing}
    </button>
  );
}

/** Ranked alternatives that hit the same muscles with what this gym has. */
export function SwapSheet({
  target,
  exercises,
  inWorkout,
  onClose,
  onPick,
}: {
  target: WorkoutExercise | null;
  exercises: Record<string, Exercise>;
  inWorkout: string[];
  onClose: () => void;
  onPick: (replacement: WorkoutExercise) => void;
}) {
  const input = useGenerateInput(!!target);
  const current = target ? exercises[target.exerciseId] : undefined;
  const options = useMemo(() => (input && current ? swapOptions(current, input, inWorkout, 10) : []), [input, current, inWorkout]);
  return (
    <Sheet open={!!target} onClose={onClose} title="Swap exercise" subtitle={current ? `Alternatives to ${current.name} that work the same muscles` : undefined}>
      {!input ? (
        <div className="stack">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 56 }} />
          ))}
        </div>
      ) : options.length === 0 ? (
        <p className="faint">No alternatives with your current equipment.</p>
      ) : (
        <div className="list">
          {options.map((o) => (
            <ExerciseRow
              key={o.id}
              ex={o}
              trailing={<Icon name="swap" size={18} />}
              onClick={() => {
                // Same number of sets still to do, and a warm-up if the original had one and it hasn't started.
                const sets = target!.sets;
                const remaining = sets.filter((s) => s.kind === 'working' && !s.drop && !s.done).length || 3;
                const warmup = sets.some((s) => s.kind === 'warmup') && !sets.some((s) => s.done);
                onPick(planExercise(o, input, remaining, warmup));
              }}
            />
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** Searchable picker for adding any exercise to a workout. */
export function AddExerciseSheet({
  open,
  exercises,
  inWorkout,
  onClose,
  onPick,
}: {
  open: boolean;
  exercises: Exercise[];
  inWorkout: string[];
  onClose: () => void;
  onPick: (we: WorkoutExercise) => void;
}) {
  const input = useGenerateInput(open);
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<MuscleId | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const used = new Set(inWorkout);
  const query = q.trim().toLowerCase();
  const list = exercises
    .filter((e) => !used.has(e.id))
    .filter((e) => !onlyAvailable || !input || isAvailable(e, input.equipment))
    .filter((e) => !muscle || e.primary.includes(muscle))
    .filter((e) => !query || e.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Sheet open={open} onClose={onClose} title="Add exercise">
      <div className="stack">
        <div className="search">
          <Icon name="search" size={18} />
          <input className="input" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search exercises" />
        </div>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={onlyAvailable} onClick={() => setOnlyAvailable(!onlyAvailable)}>
            At this gym
          </button>
          {MUSCLE_IDS.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={muscle === m} onClick={() => setMuscle(muscle === m ? null : m)}>
              {MUSCLES[m].name}
            </button>
          ))}
        </div>
        <div className="list">
          {list.slice(0, 80).map((e) => (
            <ExerciseRow
              key={e.id}
              ex={e}
              disabled={!input}
              trailing={<Icon name="plus" size={18} />}
              onClick={() => input && onPick(planExercise(e, input, e.mechanic === 'compound' ? 3 : 2, false))}
            />
          ))}
          {list.length === 0 && <p className="faint small" style={{ padding: '12px 0' }}>No matches.</p>}
        </div>
      </div>
    </Sheet>
  );
}
