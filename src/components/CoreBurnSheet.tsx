import { useEffect, useMemo, useState } from 'react';
import { loadGenerateInput } from '../db/repo';
import { buildCoreBurn, CORE_BURN_LENGTHS, type CoreBurnPlan } from '../engine/coreBurn';
import type { GenerateInput } from '../engine/generator';
import { formatWeight } from '../engine/load';
import { MUSCLES } from '../engine/muscles';
import { isTimed } from '../engine/progression';
import type { Exercise, Units, WorkoutExercise } from '../engine/types';
import { MuscleThumb } from './BodyMap';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './CoreBurnSheet.css';

/** "20 reps", "30 s", "20 s each side", "15 × 35 lb" for one move of a burn. */
export function burnTargetText(we: WorkoutExercise, ex: Exercise | undefined, units: Units): string {
  const s = we.sets[0];
  if (!s || !ex) return '';
  const each = ex.unilateral ? ' each side' : '';
  if (isTimed(ex)) return `${s.targetReps} s${each}`;
  const load = s.targetWeightKg > 0 ? ` × ${formatWeight(s.targetWeightKg, units)}` : '';
  return `${s.targetReps}${load ? load : ' reps'}${each}`;
}

const newSeed = () => 1 + Math.floor(Math.random() * 1e9);

/**
 * Pick a core burn to tack on the end: a length, a preview of the moves,
 * shuffle until it looks right, add.
 */
export function CoreBurnSheet({
  open,
  exclude,
  exercises,
  units,
  onAdd,
  onClose,
}: {
  open: boolean;
  /** Exercises already in the workout. */
  exclude: string[];
  exercises: Record<string, Exercise>;
  units: Units;
  onAdd: (burn: CoreBurnPlan) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState<GenerateInput | null>(null);
  const [minutes, setMinutes] = useState<number>(8);
  const [seed, setSeed] = useState(newSeed);
  useEffect(() => {
    if (open) {
      setSeed(newSeed());
      void loadGenerateInput().then(setInput);
    }
  }, [open]);
  const key = exclude.join();
  const burn = useMemo(() => (input ? buildCoreBurn(input, minutes, { exclude: key ? key.split(',') : [], seed }) : null), [input, minutes, seed, key]);

  return (
    <Sheet open={open} onClose={onClose} title="Core burn" subtitle="A quick ab circuit to finish: one move straight into the next, round by round.">
      <div className="stack lg">
        <div className="segmented" role="group" aria-label="Length">
          {CORE_BURN_LENGTHS.map((m) => (
            <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
              {m} min
            </button>
          ))}
        </div>

        {!burn ? (
          <div className="stack">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 56 }} />
            ))}
          </div>
        ) : burn.exercises.length === 0 ? (
          <p className="faint">No core moves to pick from here. Check the exercises you've hidden.</p>
        ) : (
          <>
            <p className="cb-summary small muted">
              <span className="num">{burn.exercises.length}</span> moves · <span className="num">{burn.rounds}</span> rounds · about{' '}
              <span className="num">{burn.estimate}</span> min. 10 s to switch moves, 30 s between rounds.
            </p>
            <ol className="cb-moves">
              {burn.exercises.map((we) => {
                const ex = exercises[we.exerciseId];
                return (
                  <li key={we.id}>
                    {ex && <MuscleThumb primary={ex.primary} secondary={ex.secondary} size={40} />}
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="cb-name">{ex?.name ?? we.exerciseId}</span>
                      <span className="small faint">{ex?.primary.map((m) => MUSCLES[m].name).join(', ')}</span>
                    </span>
                    <span className="cb-target num">{burnTargetText(we, ex, units)}</span>
                  </li>
                );
              })}
            </ol>
          </>
        )}

        <div className="stack">
          <button type="button" className="btn primary block lg" disabled={!burn?.exercises.length} onClick={() => burn && onAdd(burn)}>
            <Icon name="flame" size={18} /> Add to the end
          </button>
          <button type="button" className="btn ghost block" disabled={!burn} onClick={() => setSeed(newSeed())}>
            <Icon name="refresh" size={17} /> Shuffle moves
          </button>
        </div>
      </div>
    </Sheet>
  );
}
