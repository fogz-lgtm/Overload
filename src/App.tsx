import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TabBar } from './components/TabBar';
import { useProfile } from './hooks';
import { ExerciseDetail } from './pages/ExerciseDetail';
import { History } from './pages/History';
import { Library } from './pages/Library';
import { Onboarding } from './pages/Onboarding';
import { Progress } from './pages/Progress';
import { Settings } from './pages/Settings';
import { Today } from './pages/Today';
import { WorkoutDetail } from './pages/WorkoutDetail';
import { WorkoutLogger } from './pages/WorkoutLogger';

// The coach pulls in the Anthropic SDK; only load it for people who use it.
const Coach = lazy(() => import('./pages/Coach').then((m) => ({ default: m.Coach })));

export function App() {
  const profile = useProfile();
  if (profile === undefined) return null;
  if (profile === null || !profile.onboarded) return <Onboarding />;

  // Hash routing keeps the app working from any static host (GitHub Pages, a USB stick…).
  return (
    <HashRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/workout/:id" element={<WorkoutLogger />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:id" element={<WorkoutDetail />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/library" element={<Library />} />
          <Route path="/library/:id" element={<ExerciseDetail />} />
          <Route
            path="/coach"
            element={
              <Suspense fallback={null}>
                <Coach />
              </Suspense>
            }
          />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <TabBar />
    </HashRouter>
  );
}
