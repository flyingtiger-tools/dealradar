-- Persiste le coût de livraison déjà collecté par les connecteurs marketplace
-- (ex. eBay `shippingOptions[0].shippingCost`) mais jusqu'ici silencieusement
-- perdu à la persistance. Sans cette colonne, `ingest-and-analyze` ne pouvait
-- qu'assumer un coût de livraison de 0 dans le calcul de profit (limite
-- documentée dans l'ADR 0008, désormais levée).
alter table public.listings
  add column shipping_cost_cents bigint check (shipping_cost_cents >= 0);
