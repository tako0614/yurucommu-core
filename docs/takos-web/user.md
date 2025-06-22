### /_takos/users/create

req: { userId: string, icon: string, description: string, type: "public" or
"private" }

### /_takos/users/delete

req: { userId: string, }

### /_takos/users/update

req: { userId: string, icon: string, description: string, type: "public" or
"private" }

### /_takos/users/selected (GET)

res: { userId: string }

### /_takos/users/selected (POST)

req: { userId: string }
