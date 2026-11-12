-- manifest: **(Acelera) Regra de conversão da Meta aceita `Contact`, `Respondidos` e `Schedule`.** São os nomes que o Tintim já mandava ao conjunto de dados; manter o nome mantém o histórico e as campanhas que otimizam por eles. Só amplia o CHECK de `meta_ads_conversion_rules`. Aditiva.
alter table public.meta_ads_conversion_rules
  drop constraint if exists meta_ads_conversion_rules_evento_conhecido;
alter table public.meta_ads_conversion_rules
  add constraint meta_ads_conversion_rules_evento_conhecido
  check (meta_event in (
    'LeadSubmitted', 'QualifiedLead', 'InitiateCheckout', 'AddToCart', 'ViewContent',
    'Contact', 'Respondidos', 'Schedule'
  ));
