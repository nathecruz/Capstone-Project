import { getPredictionPresentation } from '@/utils/ai-presentation';

describe('getPredictionPresentation', () => {
  it('labels a model response as an experimental forecast', () => {
    expect(getPredictionPresentation({ is_fallback: false }, false)).toMatchObject({
      label: 'ML model forecast',
      hasForecast: true,
    });
  });

  it('distinguishes deterministic fallback output from a trained model', () => {
    expect(getPredictionPresentation({ is_fallback: true }, false)).toMatchObject({
      label: 'Deterministic fallback',
      hasForecast: true,
    });
  });

  it('labels unavailable output as recorded progress rather than a forecast', () => {
    expect(getPredictionPresentation(null, false)).toMatchObject({
      label: 'Recorded progress',
      hasForecast: false,
    });
  });

  it('does not claim a forecast while the model request is loading', () => {
    expect(getPredictionPresentation(null, true)).toMatchObject({
      label: 'Loading forecast',
      hasForecast: false,
    });
  });
});