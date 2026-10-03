import { canonicalRedirect } from '@/utils/canonical-host';
import { rankSummary } from '@/utils/rank';

const at = (hostname: string, pathname = '/profile', search = '', hash = '') => ({ hostname, pathname, search, hash });
const app = 'https://capstone-project-indol-five.vercel.app';

describe('canonicalRedirect', () => {
  it('sends a per-deploy Vercel address to the main address, same page', () => {
    expect(canonicalRedirect(at('capstone-project-gbvtscz85-team-c14.vercel.app', '/today-progress', '?date=2026-10-02', '#top'), app))
      .toBe('https://capstone-project-indol-five.vercel.app/today-progress?date=2026-10-02#top');
  });

  it('leaves the main address, local development and other hosting alone', () => {
    expect(canonicalRedirect(at('capstone-project-indol-five.vercel.app'), app)).toBeNull();
    expect(canonicalRedirect(at('localhost'), app)).toBeNull();
    expect(canonicalRedirect(at('habitai-frontend.onrender.com'), app)).toBeNull();
    expect(canonicalRedirect(at('capstone-project-gbvtscz85-team-c14.vercel.app'), 'not a url')).toBeNull();
  });
});

describe('rankSummary', () => {
  it('describes the place from the real ranking', () => {
    expect(rankSummary(1, 12)).toEqual({ title: 'Top of the class', topPercent: 9, standing: 'Top 9%', of: 'of 12 students' });
    expect(rankSummary(3, 12)).toEqual({ title: 'Rising star', topPercent: 25, standing: 'Top 25%', of: 'of 12 students' });
    expect(rankSummary(6, 12).title).toBe('Steady climber');
    expect(rankSummary(12, 12)).toEqual({ title: 'Keep climbing', topPercent: 100, standing: 'Every check-in counts', of: 'of 12 students' });
    expect(rankSummary(1, 1).of).toBe('of 1 student');
  });
});
