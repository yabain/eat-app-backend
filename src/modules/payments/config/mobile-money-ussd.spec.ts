import { getConfirmationUssd } from './mobile-money-ussd';

describe('getConfirmationUssd', () => {
  const originalOrange = process.env.MOBILE_MONEY_USSD_ORANGE;
  const originalMtn = process.env.MOBILE_MONEY_USSD_MTN;

  beforeEach(() => {
    delete process.env.MOBILE_MONEY_USSD_ORANGE;
    delete process.env.MOBILE_MONEY_USSD_MTN;
  });

  afterAll(() => {
    if (originalOrange === undefined) delete process.env.MOBILE_MONEY_USSD_ORANGE;
    else process.env.MOBILE_MONEY_USSD_ORANGE = originalOrange;
    if (originalMtn === undefined) delete process.env.MOBILE_MONEY_USSD_MTN;
    else process.env.MOBILE_MONEY_USSD_MTN = originalMtn;
  });

  it('Orange : défaut #150*50# quand la variable est absente', () => {
    expect(getConfirmationUssd('ORANGEMONEY')).toBe('#150*50#');
  });

  it('MTN : défaut *126# quand la variable est absente', () => {
    expect(getConfirmationUssd('MTN')).toBe('*126#');
  });

  it('variable vide → null (aucun code affiché)', () => {
    process.env.MOBILE_MONEY_USSD_ORANGE = '';
    process.env.MOBILE_MONEY_USSD_MTN = '';
    expect(getConfirmationUssd('ORANGEMONEY')).toBeNull();
    expect(getConfirmationUssd('MTN')).toBeNull();
  });

  it('variable définie → valeur renvoyée (sans espaces superflus)', () => {
    process.env.MOBILE_MONEY_USSD_ORANGE = ' #111*22# ';
    process.env.MOBILE_MONEY_USSD_MTN = '*999#';
    expect(getConfirmationUssd('ORANGEMONEY')).toBe('#111*22#');
    expect(getConfirmationUssd('MTN')).toBe('*999#');
  });
});
