import { joinName, namesOf, splitFullName } from '@/utils/names';

describe('names', () => {
  it('splits older full names, keeping surname particles and suffixes with the last name', () => {
    expect(splitFullName('Juan Dela Cruz')).toEqual({ firstName: 'Juan', lastName: 'Dela Cruz' });
    expect(splitFullName('Maria Clara de los Santos')).toEqual({ firstName: 'Maria Clara', lastName: 'de los Santos' });
    expect(splitFullName('Jose Rizal Jr.')).toEqual({ firstName: 'Jose', lastName: 'Rizal Jr.' });
    expect(splitFullName('Zaira')).toEqual({ firstName: 'Zaira', lastName: '' });
  });

  it('joins first and last name', () => {
    expect(joinName(' Juan ', ' Dela  Cruz')).toBe('Juan Dela Cruz');
    expect(joinName('Juan', '')).toBe('Juan');
  });

  it('prefers stored first and last names over the full name', () => {
    expect(namesOf({ firstName: 'Ana', lastName: 'Reyes', fullName: 'Old Name' })).toEqual({ firstName: 'Ana', lastName: 'Reyes', fullName: 'Ana Reyes' });
    expect(namesOf({ fullName: 'Ana Reyes' })).toEqual({ firstName: 'Ana', lastName: 'Reyes', fullName: 'Ana Reyes' });
  });
});
