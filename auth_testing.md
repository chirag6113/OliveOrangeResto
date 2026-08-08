# Auth Testing Playbook

1. Login: `curl -X POST $API/api/auth/login -H "Content-Type: application/json" -d '{"email":"oliveorangetechnologies@gmail.com","password":"Admin@123"}'` → expect `{token, user}` with role `owner`.
2. Me: `curl $API/api/auth/me -H "Authorization: Bearer <token>"` → same user.
3. Wrong password → 401. Missing token → 401.
4. Frontend: /admin/login, login stores `staff_token` in localStorage, Bearer header on all /api/admin/* calls.
