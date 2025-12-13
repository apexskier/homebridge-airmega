Link plugin globally to get local homebridge to pick it up.

```bash
npm link
```

Run homebridge locally with your local plugin and logs.

```bash
npm run build && DEBUG=*apexskier* homebridge -D -I
```

- `-D`: debug mode
- `-I`: show accessories in homebridge UI
