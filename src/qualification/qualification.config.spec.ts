import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_QUALIFICATION_CONFIG,
  mergeQualificationConfig,
  mergeQualificationPatch,
  scoreQualification,
  validateQualificationConfig,
  type QualificationConfig,
} from './qualification.config';

const config = (): QualificationConfig =>
  JSON.parse(
    JSON.stringify(DEFAULT_QUALIFICATION_CONFIG),
  ) as QualificationConfig;

describe('qualification config', () => {
  it('validates the shipped defaults', () => {
    expect(validateQualificationConfig(config())).toBeUndefined();
  });

  it('falls back to defaults for junk stored values', () => {
    expect(mergeQualificationConfig(null)).toEqual(
      DEFAULT_QUALIFICATION_CONFIG,
    );
    expect(mergeQualificationConfig({ criteria: [] })).toEqual(
      DEFAULT_QUALIFICATION_CONFIG,
    );
  });

  it('rejects unknown patch keys', () => {
    expect(() => mergeQualificationPatch(config(), { nope: 1 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a choice criterion with no options', () => {
    const c = config();
    c.criteria = [
      {
        id: 'budget',
        label: 'Budget',
        type: 'choice',
        required: false,
        score: 0,
        choices: [],
      },
    ];
    expect(() => validateQualificationConfig(c)).toThrow(BadRequestException);
  });

  it('rejects duplicate criterion ids', () => {
    const c = config();
    c.criteria = [
      { id: 'dup', label: 'A', type: 'boolean', required: false, score: 1 },
      { id: 'dup', label: 'B', type: 'boolean', required: false, score: 1 },
    ];
    expect(() => validateQualificationConfig(c)).toThrow(BadRequestException);
  });
});

describe('scoreQualification', () => {
  it('awards boolean points only when the answer is true', () => {
    const withTrue = scoreQualification(config(), {
      owns_property: true,
      roof_suitable: true,
    });
    const withFalse = scoreQualification(config(), {
      owns_property: false,
      roof_suitable: false,
    });
    expect(withTrue.score).toBe(45);
    expect(withFalse.score).toBe(0);
  });

  it('awards the selected choice’s score', () => {
    const { score } = scoreQualification(config(), {
      owns_property: true,
      roof_suitable: true,
      budget_band: '10k_20k',
      timeframe: 'now',
    });
    // 25 + 20 + 20 + 15
    expect(score).toBe(80);
  });

  it('reports required criteria left blank', () => {
    const { missingRequired } = scoreQualification(config(), {
      decision_maker: true,
    });
    expect(missingRequired.sort()).toEqual(['owns_property', 'roof_suitable']);
  });

  it('treats false as answered, not blank', () => {
    const { missingRequired } = scoreQualification(config(), {
      owns_property: false,
      roof_suitable: false,
    });
    expect(missingRequired).toEqual([]);
  });

  it('ignores answers for criteria that no longer exist', () => {
    const { score } = scoreQualification(config(), {
      owns_property: true,
      removed_criterion: 'whatever',
    });
    expect(score).toBe(25);
  });

  it('ignores an unknown choice value', () => {
    const { score } = scoreQualification(config(), {
      owns_property: true,
      budget_band: 'made_up',
    });
    expect(score).toBe(25);
  });

  it('caps a number criterion at its max', () => {
    const c = config();
    c.criteria = [
      {
        id: 'kw',
        label: 'System size',
        type: 'number',
        required: false,
        score: 5,
        max: 30,
      },
    ];
    expect(scoreQualification(c, { kw: 2 }).score).toBe(10);
    // 100 × 5 would be 500 without the cap.
    expect(scoreQualification(c, { kw: 100 }).score).toBe(30);
  });
});
