---
impacto: capacidade_nova
secao: adicionado
titulo: Cliente ativo e cancelamento informados à Meta
---

O CRM agora conta à Meta a vida do cliente depois da venda, não só o fechamento. Quando uma reunião com um cliente do funil de clientes é marcada como realizada na agenda, sai o evento `ClienteAtivo` com o valor da mensalidade — no máximo um por cliente por mês, então quanto mais meses o cliente fica, mais valor a Meta soma para aquele perfil. Perder um negócio do funil de clientes sai como o evento `Cancelamento`, sem valor. A venda inicial não é contada de novo: o ganho no funil de clientes não manda um segundo `Purchase`.

Só vale para contatos que vieram de anúncio da Meta e que têm mensalidade preenchida no negócio. Se você não usa funil de clientes, nada muda.
