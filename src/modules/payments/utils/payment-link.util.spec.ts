import { isAllowedPaymentLink } from './payment-link.util';

describe('isAllowedPaymentLink', () => {
  it.each([
    'https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-XXXX',
    'https://checkout.flutterwave.com/',
  ])('accepte %s', (url) => {
    expect(isAllowedPaymentLink(url)).toBe(true);
  });

  it.each([
    'http://checkout.flutterwave.com/v3/hosted/pay/x',
    'javascript:alert(1)',
    'https://checkout.flutterwave.com.evil.example/pay',
    'https://evil.example/checkout.flutterwave.com',
    'https://evil.example',
    'https://user:pass@checkout.flutterwave.com/pay',
    'https://checkout.flutterwave.com:8443/pay',
    'https://checkout.flutterwave.com:8080/v3/hosted/pay/x',
    'not a url',
    '',
  ])('refuse %s', (url) => {
    expect(isAllowedPaymentLink(url)).toBe(false);
  });

  it('refuse null, undefined et non-chaînes', () => {
    expect(isAllowedPaymentLink(null)).toBe(false);
    expect(isAllowedPaymentLink(undefined)).toBe(false);
    expect(isAllowedPaymentLink(42)).toBe(false);
  });
});
