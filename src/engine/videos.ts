import type { ExercisePref } from './types';

/**
 * A YouTube form demo for each built-in exercise: short technique tutorials
 * that show this exact variation and equipment. Keyed by exercise id.
 */
export const EXERCISE_VIDEOS: Record<string, string> = {
  'barbell-bench-press': 'rT7DgCr-3pg', // How To: Barbell Bench Press
  'incline-barbell-bench-press': 'SrqOu55lrYU', // How To: Incline Barbell Bench Press
  'close-grip-bench-press': 'UYJsFzqdgK4', // HOW TO: Close-Grip Bench Press (TRICEPS BUILDER) || PERFECT FORM
  'dumbbell-bench-press': 'Y_7aHqXeCfQ', // How To: Dumbbell Bench Press
  'incline-dumbbell-press': 'hChjZQhX1Ls', // How To: Dumbbell Incline Press
  'dumbbell-floor-press': 'T0Y3OBF1bNI', // How To Do A Dumbbell Floor Press
  'dumbbell-fly': 'QENKPHhQVi4', // How to Properly Do a DUMBBELL FLY
  'cable-fly': 'XNf6TBErGys', // How to do a Two-Arm Standing Cable Fly
  'pec-deck': 'hZ0CGRaKwbQ', // Pec Deck / Chest Fly: How To
  'machine-chest-press': '4YpxZXFADmc', // How to Adjust & Use the Chest Press Machine Correctly
  'smith-machine-bench-press': '7FyJdsXeta8', // Exercise Tutorial: Smith Machine Bench Press
  'push-up': 'zF0jbubK_jU', // How To Do A Push-Up: Proper Form & Technique
  dip: 'U7HeutDqS_w', // How To Do Parallel Bar Dips
  'barbell-overhead-press': '3VpI0V_9D0Y', // How to Do the Standing Barbell Overhead Press
  'dumbbell-shoulder-press': 'WKEl69bIGus', // How to Do the Seated Dumbbell Shoulder Press
  'arnold-press': '6Z15_WdXmVw', // Arnold Press - Shoulder Exercise - Proper Form Tutorial
  'machine-shoulder-press': 'c3Z8NXdcvEs', // Exercise Tutorial: Technogym Shoulder Press Machine (Neutral Grip)
  'smith-machine-overhead-press': 'qEIEpWb2Ic8', // HOW TO PERFORM SMITH MACHINE OVERHEAD PRESS
  'pike-push-up': 'shEnAXgc9y4', // How To Do Pike Push-Ups
  'kettlebell-overhead-press': 'X-uFqWtjpGI', // How to do a Kettlebell Overhead Press
  'lateral-raise': 'ssAo_xwFt5c', // How to Do Dumbbell Lateral Raises
  'cable-lateral-raise': 'Z5FA9aq3L6A', // How To Do Cable Lateral Raises
  'machine-lateral-raise': 'uh1UO-ieTYQ', // Lateral Raise Machine (Tutorial + Tips)
  'band-lateral-raise': 'gfEyrmxbCbw', // How To: Resistance Band Lateral Raise
  'dumbbell-front-raise': 'zkP0MsTcIVU', // How To Do A Dumbbell Front Raise
  'ez-bar-upright-row': 'gH_SOQE4urM', // EZ BAR UPRIGHT ROW (How To)
  'face-pull': 'eTCBSFlCJ_s', // How to do a Face Pull
  'band-face-pull': '0Vt5lYcykMc', // How to do Banded Face Pulls // tutorial
  'rear-delt-fly': 'UO_v23hHAdM', // Bent Over Dumbbell Rear Delt Flyes (Exercise Tutorial + Form Tips)
  'reverse-pec-deck': 'E4Q12zRDwwU', // How to do Reverse Pec Deck Fly
  'cable-rear-delt-fly': 'er15V96hG5U', // How To Do Cable Rear Delt Flyes
  'band-pull-apart': 'smSSXITNpCI', // How To Do Band Pull Aparts
  'prone-y-raise': 'DQFTp5n0uh0', // How to Do a Prone Y Raise
  'barbell-deadlift': 'PlWyD8T9wo0', // Barbell Deadlift: How To (3 steps to proper form)
  'romanian-deadlift': 'lKLYvNGz6mk', // Barbell Romanian Deadlift - Proper Form & Technique [4K]
  'trap-bar-deadlift': 'EsqwERaSTMI', // How To Trap Bar Deadlift *Build Strength And Size*
  'sumo-deadlift': 'fKrujxCPRKI', // Sumo Deadlift - Proper Form & Technique [4K]
  'good-morning': 'nWyx81AfTos', // How To Do A Barbell Good Morning
  'barbell-row': 'Suk0NfWV3fg', // How to Barbell Row
  'dumbbell-row': 'fURsHPHgssI', // Single-Arm Dumbbell Row on a Bench: Perfect Form Tutorial
  'chest-supported-dumbbell-row': 'ro2vfHfD0DQ', // How To Do A Chest Supported Dumbbell Row Correctly
  'seated-cable-row': 'EU7bOadUsNI', // Seated Cable Row - Proper Form & Technique [4K]
  'machine-row': 'QpLTp2AJ_cI', // Machine Chest Supported Row Tutorial
  'inverted-row': 'uL2rJFAbcRM', // How To Do a Barbell Inverted Row
  'band-row': 'LSkyinhmA8k', // How To Do A Resistance Band Row
  'kettlebell-row': 'k5BC9d6pR3A', // Kettlebell Row - Proper Form & Technique [4K]
  'pull-up': '9yVGh3XbJ34', // How to do a Pull-Up
  'chin-up': 'liebDvbcdow', // Chin-Up - Proper Form & Execution
  'lat-pulldown': 'CAwf7n6Luuc', // How To: Lat Pulldown
  'straight-arm-pulldown': 'duHQk2PxNos', // Cable Straight Arm Pulldown - Proper Form & Technique [4K]
  'dumbbell-pullover': 'Ydpy886udzo', // How to Perform Dumbbell Pullovers - Chest Exercise
  'barbell-shrug': '9xGqgGFAtiM', // Barbell Shrug - Shoulder Exercise - Bodybuilding.com
  'dumbbell-shrug': 'xiLT85G_GuU', // Dumbbell Shrug (Proper Form)
  'trap-bar-shrug': 'IJiEOqZgTz0', // How To Do A TRAP BAR SHRUG
  'farmers-carry': '62v48abT5-Y', // Dumbbell Farmer's Walk : Proper Form and Common Mistakes to Avoid
  'trap-bar-carry': 'dH6qD-SHoMI', // How To Do A TRAP BAR FARMERS WALK
  'suitcase-carry': 'CgJup_IrnCw', // Dumbbell Suitcase Carry - Proper Form & Technique [4K]
  'dead-hang': 'g0I7Jv3oqKw', // How to Dead Hang Properly - Grip, Form & Progressions
  'barbell-curl': 'dDI8ClxRS04', // Barbell Curl - Biceps Exercise - Bodybuilding.com
  'ez-bar-curl': 'S_i3SEVgKWU', // EZ-Bar Curl - Biceps Exercise - Bodybuilding.com
  'dumbbell-curl': 'ykJmrZ5v0Oo', // How to Do a Dumbbell Biceps Curl
  'hammer-curl': 'zC3nLlEvin4', // How To: Dumbbell Hammer Curl
  'incline-dumbbell-curl': 'e3zNNfjJszA', // Incline Dumbbell Curl Form (How-To in 90 Seconds)
  'cable-curl': '16aEi1a68E0', // How to Do the Cable Biceps Curl With Perfect Form
  'machine-preacher-curl': 'to3m8zws1n8', // Machine Bicep Preacher Curl: How To
  'band-curl': 'RyWX9e7imhc', // How to Do Bicep Curls with Resistance Bands
  'reverse-curl': 'e0Mu2jC4nRk', // How To Do Reverse Grip EZ Bar Bicep Curls
  'dumbbell-wrist-curl': 'VGkF2NTtao0', // Dumbbell Wrist Curl
  'triceps-pushdown': 'ozwo9RGm7QU', // How to Do a Tricep Pushdown
  'overhead-triceps-extension': 'IJ6J7EKprsc', // Two-Arm Overhead Triceps Extension with Dumbbells Tutorial
  'cable-overhead-triceps-extension': '0zCkuAyfKpU', // How to do Overhead Cable Tricep Extensions Correctly
  'skull-crusher': 'GaK2da6B2zM', // EZ Bar Skull Crushers: How To
  'diamond-push-up': '_4EGPVJuqfA', // Diamond Push-Ups Tutorial (with correct form)
  'bench-dip': 'WVeZDBhZwLA', // How to do a Bench Dip
  'band-triceps-pushdown': 'qjPN6ElNqpc', // How To Do Banded Tricep Pushdowns
  'barbell-back-squat': 'T_t85kQEDWk', // Form Check: How To Barbell Back Squat
  'front-squat': 'oHCApwG5OZY', // How to Do the Barbell Front Squat
  'smith-machine-squat': 'iAcRGCsG_PY', // Exercise Tutorial: Smith Machine Squat
  'hack-squat': 'hglQExHCM9Q', // Hack Squat Machine (Exercise Tutorial + Form Tips)
  'leg-press': 'tg-jOYwhI5w', // How to do a Leg Press Correctly
  'goblet-squat': '-utXQMqTuVA', // Dumbbell Goblet Squat - Proper Form & Technique [4K]
  'kettlebell-goblet-squat': 'MWHIs0zxkCU', // How to do a Kettlebell Goblet Squat
  'bodyweight-squat': 'ZLJBfYF_oO0', // Bodyweight Squat: How To (3 steps to proper form)
  'pistol-squat': 'hfNYuja5xTw', // How to Do a Pistol Squat Correctly
  'bulgarian-split-squat': 'iwV9rTHKrOg', // How to Dumbbell Bulgarian Split Squat in 45 Seconds
  'walking-lunge': 'I34ysEkPK7w', // Dumbbell Walking Lunge - How To
  'reverse-lunge': '-Nr6dqEvz3Q', // How To Do A Reverse Lunge Correctly
  'step-up': 'hgkk12L_Umk', // HOW TO DO A DUMBBELL STEP-UP
  'leg-extension': 'MXvSzXEBOTI', // Leg Extension - Proper Form & Technique [4K]
  'lying-leg-curl': 'lUH80pneL5w', // How to do a Lying Leg Curl
  'seated-leg-curl': 'Z5pRnXaCjpM', // Seated Leg Curl: How To
  'nordic-curl': 'Yn7aqLkeF0U', // How To Do Nordic Hamstring Curls
  'dumbbell-romanian-deadlift': 'hQgFixeXdZo', // Dumbbell Romanian (RDL) Deadlift |TECHNIQUE for Beginners
  'single-leg-rdl': 'k83AIfjDbnI', // How to do a Dumbbell or Kettlebell Single-Leg RDL (Romanian Deadlift)
  'dumbbell-stiff-leg-deadlift': 'w9_PudlkeLI', // Stiff Legged Dumbbell Deadlift - Legs / Glutes Exercise - Bodybuilding.com
  'hip-thrust': 'S_uZP4UH6J0', // How To Do A Barbell Hip Thrust The RIGHT Way! (FIX THIS!!!)
  'smith-machine-hip-thrust': 'qWhloAdOIBc', // Exercise How To: Smith Machine Hip Thrust
  'glute-bridge': 'OUgsJ8-Vi0E', // How to Perform the Perfect Glute Bridge
  'cable-kickback': 'l4zReIOfPCQ', // How To Cable Kickback (Glute Kickback Form Tutorial)
  'hip-abduction-machine': '5O_Y9l__iao', // Seated Hip Abduction Machine: How To
  'band-lateral-walk': 'cbDudaLroVs', // How to Perform Lateral Band Walks
  'hip-adduction-machine': 'ScqpbvOZWe8', // Hip Adduction Machine: How To
  'cossack-squat': 'd4IPCXI8GQc', // How To COSSACK Squat Tutorial // School of Calisthenics
  'copenhagen-plank': 'gsWpUFyVRyM', // Copenhagen Plank Tutorial
  'dumbbell-sumo-squat': 'MwNY25e4QEA', // How To: Dumbbell Sumo Squat
  'kettlebell-swing': 'B_x0tp3HIbk', // How To Do a Proper Kettlebell Swing (Beginner-Friendly Form Tutorial)
  'back-extension': 'qtjJUWCnDyE', // Hyperextensions (Back Extensions) - Core / Back Exercise - Bodybuilding.com
  superman: 'z6PJMT2y8GQ', // Exercise Tutorial - Superman
  'standing-calf-raise': 'yYBAQGtpIyM', // How To: Standing Machine Calf Raise
  'seated-calf-raise': 'smyXy_dhXo8', // How To: Seated Calf Raise Machine
  'leg-press-calf-raise': 'sluiSitVePs', // Leg Press Calf Raise (Proper Form)
  'dumbbell-calf-raise': 'wxwY7GXxL4k', // Standing Dumbbell Calf Raises - Calf Exercise - Bodybuilding.com
  'single-leg-calf-raise': 'qPd73snQfUs', // Single-Leg Calf Raise (HSS)
  plank: 'mwlp75MS6Rg', // How to do a Plank
  'side-plank': 'pitOuJxdyI0', // How to do a Side Plank
  'hanging-leg-raise': 'Nw0LOKe3_l8', // Hanging Leg Raise - Ab Exercise - Bodybuilding.com
  'vertical-knee-raise': '7KDDZtaUaxw', // How To Do A CAPTAIN'S CHAIR KNEE RAISE
  'cable-crunch': '0KEP6A1deBE', // Exercise Tutorial: Kneeling Cable Crunch
  'pallof-press': 'h66babJLO74', // How To Do the Cable Pallof Press Correctly
  'band-pallof-press': 'iBDXkpKDRy8', // Band Pallof Press - Proper Form & Technique [4K]
  'cable-woodchop': 'yPvAj_X_5NM', // How To Do a Cable Wood Chop
  'dumbbell-side-bend': 'UUQHeBRE_Wo', // Dumbbell Side Bend - Core / Abs - Bodybuilding.com
  'dead-bug': 'bxn9FBrt4-A', // How to do a Dead Bug
  'dumbbell-crunch': 'GnOtkztXWQs', // How To Do: Dumbbell Crunch - Floor
  'turkish-get-up': 'ZutpEZ2B7Uc', // How to do a Kettlebell Turkish Get Up - Nuffield Health
};

const ID = /^[\w-]{11}$/;

/** The video id in a YouTube link (watch, youtu.be, shorts, embed, live) or a bare id. */
export function youtubeId(input: string): string | undefined {
  const text = input.trim();
  if (ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null | undefined;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1];
  }
  return id && ID.test(id) ? id : undefined;
}

/** The lifter's own pick for this exercise, else the built-in demo. */
export function videoFor(exerciseId: string, pref?: Pick<ExercisePref, 'video'> | null): string | undefined {
  return pref?.video || EXERCISE_VIDEOS[exerciseId];
}

export const videoThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Privacy-enhanced embed: YouTube sets no cookies until the video plays. */
export const videoEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;

export const videoSearch = (name: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} exercise proper form`)}`;
