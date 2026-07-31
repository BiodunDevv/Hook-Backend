# Pricing Engine Specification

All calculations use integer minor units and one currency.

```text
effectivePrice = sellingPrice - discount
markup = sellingPrice - basePrice
margin = effectivePrice - basePrice
marginPercent = margin / effectivePrice * 100
```

Negotiation uses an immutable snapshot of selling price, approved floor, maximum discount, variant, quantity, currency, and rule version.

For three customer offers, acceptance thresholds are:

1. One third of the approved concession range
2. Two thirds of the approved concession range
3. The Commercial floor

Offers at or above the round threshold are accepted. Lower offers receive the threshold as a counter, except a final below-floor offer is declined. OpenAI cannot change outcomes, prices, thresholds, or quote terms.
