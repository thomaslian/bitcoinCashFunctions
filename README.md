# Bitcoin Cash Functions
Firebase functions for a Bitcoin Cash payment system

## How to run
- Emulator - for testing purposes
```
firebase emulators:start
```

- Install dependencies from package.json
```
npm install
```

- Deploy functions only to firebase
```
firebase deploy --only functions
```

- Deploy only one function to firebase
```
firebase deploy --only functions:addMessage
```