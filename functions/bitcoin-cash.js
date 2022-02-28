
// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');
// The Firebase Admin SDK to access Cloud Firestore.
const admin = require('firebase-admin');

// Bitcoin Cash functions to create addresses, check balances and send transactions.
// https://github.com/Bitcoin-com/bitbox-sdk
const { BITBOX } = require('bitbox-sdk');

/**
 * Create a new Bitcoin Cash address and key based on user UID
 */
exports.createAddress = functions.region('europe-west3').https.onCall(async (data, context) => {
    // Get user UID
    const uid = context.auth.uid;
    // New BitBox instance
    const bitbox = new BITBOX;
    // create mnemonic
    const mnemonic = bitbox.Mnemonic.generate(128);
    // create seed buffer from mnemonic
    const seedBuffer = bitbox.Mnemonic.toSeed(mnemonic);
    // create HDNode from seed buffer
    const hdNode = bitbox.HDNode.fromSeed(seedBuffer);
    // Convert to to cash address
    const cashAddr = bitbox.HDNode.toCashAddress(hdNode);
    // to wif
    const wifKey = bitbox.HDNode.toWIF(hdNode);
    // Encrypt wif key
    //const hashedWif = encrypt(wifKey);

    try {
        const userRef = admin.firestore().collection('users').doc(uid);
        const res = await userRef.update({
            bitcoinCash: FieldValue.arrayUnion({
                address: cashAddr,
                hash: hashedWif,
                uid
            })
        });
        return res;
    } catch (error) {
        error.log(error);
        return { error, message: 'There was an error creating a Bitcoin Cash address' };
    }
});

/**
* Get the balance of a users Bitcoin Cash address based on their UID
*/
exports.getBalance = functions.region('europe-west3').https.onCall(async (data, context) => {
    // Authentication / user information is automatically added to the request.
    const uid = context.auth.uid;
    // Get the Bitcoin Cash address for the specific uid
    const address = await getBitcoinCashData(uid);
    // Get the Bitcoin Cash balance data
    const balanceData = await getBitcoinCashBalance(address.address);
    // Return the balance of the address, and the address itself
    return { 'balance': balanceData.balance, 'address': address.address, 'unconfirmed': balanceData.unconfirmedBalance };
});

/**
* Get the value of Bitcoin Cash
*/
exports.getUsdValue = functions.region('europe-west3').https.onCall(async (data, context) => {
    try {
        const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd');
        const value = res.data['bitcoin-cash']['usd'];
        return { value }
    } catch (error) {
        console.log(error);
        return { 'message': "Error while getting Bitcoin Cash value" }
    }
});

/**
 * Returns the Bitcoin Cash address of a user based on the UID
 */
exports.getAddress = functions.region('europe-west3').https.onCall(async (data, context) => {
    // Get passed uid variable passed from the application
    const uid = data.uid;
    // Get the address data for the specific uid
    const addressData = await getBitcoinCashData(uid);
    // Get the Bitcoin Cash address from the addressData
    const address = addressData.address;
    // Return the Bitcoin Cash address
    return { address };
});

/**
 * Returns the transaction fee of a transaction
 */
exports.getTransactionFee = functions.region('europe-west3').https.onCall(async (data, context) => {
    // Create a new bitbox instance
    const bitbox = new BITBOX;
    // Authentication / user information is automatically added to the request.
    const uid = context.auth.uid;
    // Get satoshis to send passed from the application
    const bchToSend = bitbox.BitcoinCash.toSatoshi(data.bch);
    // Get the sender data
    const senderData = await getBitcoinCashData(uid);
    // Calculate the transaction fee
    const txFee = await getBitcoinCashTransactionFee(senderData.address, bchToSend);
    // Convert from satoshies
    const bchFee = bitbox.BitcoinCash.toBitcoinCash(txFee);
    // Return the transaction fee
    return { bchFee };
});

/**
 * Sends a transaction by using the users UID, the amount the user wants to send and the receiving address
 */
exports.sendTransaction = functions.region('europe-west3').https.onCall(async (data, context) => {
    // Create a new bitbox instance
    const bitbox = new BITBOX;
    // Authentication / user information is automatically added to the request.
    const uid = context.auth.uid;
    // Get satoshis to send passed from the application
    const bchToSend = data.bch;
    let satoshisToSend = bitbox.BitcoinCash.toSatoshi(bchToSend);
    let dustToConsolidate = 0;
    console.log('Satoshis to send: ' + satoshisToSend);
    // Get receiving address passed from the application
    const receivingAddress = data.receivingAddress;
    // Get the sender address based on the uid
    const senderAddress = await getBitcoinCashData(uid).then(address => {
        // eslint-disable-next-line eqeqeq
        if (address.uid == uid) {
            return address.address;
        } else {
            return ({ message: "Your user does not match this Bitcoin Cash address." });
        }
    })

    // Set network to mainnet
    const network = 'mainnet';

    // Get the sender Bitcoin Cash balance
    const senderData = await getBitcoinCashBalance(senderAddress);
    const senderBalance = senderData.balance;
    console.log(`Balance of sending address ${senderAddress} is ${senderBalance} BCH.`);
    // Get the receiver Bitcoin Cash balance
    const receiverData = await getBitcoinCashBalance(receivingAddress);
    const receiverBalance = receiverData.balance;
    console.log(`Balance of receiving address ${receivingAddress} is ${receiverBalance} BCH.`);

    // Exit if the balance is zero.
    if (senderBalance <= 0.0) {
        return ({ message: 'The balance of the sending address is zero' });
    }

    // Get UTXOS
    const u = await bitbox.Address.utxo(senderAddress);
    let utxo = findBiggestUtxo(u.utxos);

    const transactionBuilder = new bitbox.TransactionBuilder(network);

    let outputTxs;
    let inputTxs;
    let inputs = [];

    // If the biggest utxo is smaller than the transaction amount, consolidateDust
    if (utxo.satoshis < satoshisToSend) {
        const utxos = await bitbox.Address.utxo(senderAddress);
        // Loop through each UTXO assigned to this address.
        utxos.utxos.forEach(utxo => {
            inputs.push(utxo)
            dustToConsolidate += utxo.satoshis
            transactionBuilder.addInput(utxo.txid, utxo.vout)
        });

        if (dustToConsolidate < satoshisToSend) {
            console.error("Trying to send more satoshis than that are on the account.");
            process.exit(1);
        }

        inputTxs = inputs.length;
        outputTxs = 1;

        // Only add a transaction if the sending amount it bigger than 0. This could mean that the user is sending
        // the whole amount to its own address
        if ((dustToConsolidate - satoshisToSend) > 0) {
            // This is dust that will be consolidated (sent back to the sender address to create one big UTXO)
            transactionBuilder.addOutput(senderAddress, dustToConsolidate - satoshisToSend);
            outputTxs = 2;
        }
    } else {
        const vout = utxo.vout;
        const txid = utxo.txid;

        // Add input with txid and index of vout
        transactionBuilder.addInput(txid, vout);

        inputTxs = 1;
        outputTxs = 2;

        // Amount to send back to the sending address.
        // It's the original amount - 1 sat/byte for tx size
        const remainder = utxo.satoshis - satoshisToSend;
        // Check if remainder is more than 100. If so send satoshis back to the account
        if (remainder > 100) {
            transactionBuilder.addOutput(senderAddress, remainder);
        }
    }

    // Get byte count to calculate fee. Paying 1.0 sat/byte. 2 outputs because 2 transactions going out
    const byteCount = bitbox.BitcoinCash.getByteCount(
        { P2PKH: inputTxs },
        { P2PKH: outputTxs }
    )
    console.log(`byteCount: ${byteCount}`);


    // Set how many satoshis per byte.
    const satoshisPerByte = 1.0;
    const txFee = Math.floor(satoshisPerByte * byteCount);
    console.log(`txFee: ${txFee}`);

    // Exit if the transaction costs too much to send.
    if (dustToConsolidate && dustToConsolidate - txFee < 0) {
        console.error(`Transaction fee costs more combined UTXOs. Can't send transaction.`);
        process.exit(1);
    }

    // Output transaction to the receiver of the user's choice with amount to send
    transactionBuilder.addOutput(receivingAddress, satoshisToSend - txFee);


    // Get WIF key for the address
    const ecPair = bitbox.ECPair.fromWIF(decrypt(await getBitcoinCashData(uid).then(address => {
        return address.hash
    })));

    let redeemScript;
    if (dustToConsolidate) {
        inputs.forEach((input, index) => {
            transactionBuilder.sign(
                index,
                ecPair,
                redeemScript,
                transactionBuilder.hashTypes.SIGHASH_ALL,
                input.satoshis
            )
        });
    } else {
        // Sign the transaction
        transactionBuilder.sign(
            0,
            ecPair,
            redeemScript,
            transactionBuilder.hashTypes.SIGHASH_ALL,
            utxo.satoshis
        );
    }

    // Build tx
    const tx = transactionBuilder.build();
    // Output rawhex
    const hex = tx.toHex();
    console.log(`TX hex: ${hex}`);
    console.log();

    // Broadcast transaction to the network
    const txidStr = await bitbox.RawTransactions.sendRawTransaction([hex]);
    console.log(`Transaction ID: ${txidStr}`);
    console.log(`Check the status of your transaction on this block explorer:`);
    console.log(`https://explorer.bitcoin.com/bch/tx/${txidStr}`);

    const transferredBch = bitbox.BitcoinCash.toBitcoinCash(satoshisToSend);
    const paidFee = bitbox.BitcoinCash.toBitcoinCash(txFee);

    return { uid, transferredBch, paidFee, receivingAddress, txidStr };
});


/**
 * Get the Bitcoin Cash data for a specific user
 * @param uid - User ID
 * @returns {Promise<DocumentData>} . address.data() - Contains address, uid and key
 */
async function getBitcoinCashData(uid) {
    // Get user document reference
    const userRef = admin.firestore().doc('users/' + uid);
    // Get user data from document
    const user = await userRef.get();
    // Get address document reference
    const addressRef = admin.firestore().doc('addresses/' + user.data().addressId);
    // Get address data from document
    const addressData = await addressRef.get();
    // Return Bitcoin Cash address
    return addressData.data();
}

/**
 * Get the balance of a specific Bitcoin Cash address
 * @param address - Bitcoin Cash address
 * @returns Balance as promise
 */
async function getBitcoinCashBalance(address) {
    // Create a new BitBox instance
    const bitbox = new BITBOX;
    // Get the balance data from the address
    const balanceData = await bitbox.Address.details(address).catch(error => {
        throw new Error("There was a problem checking the balance for the address: " + address + ". " + error)
    });
    // Return balance data
    return balanceData;
}

/**
 * Returns the utxo with the biggest balance from an array of utxos.
 * @param utxos - UTXOs to sort
 * @returns Largest UTXO
 */
function findBiggestUtxo(utxos) {
    let largestAmount = 0
    let largestIndex = 0

    for (let i = 0; i < utxos.length; i++) {
        const thisUtxo = utxos[i]

        if (thisUtxo.satoshis > largestAmount) {
            largestAmount = thisUtxo.satoshis
            largestIndex = i
        }
    }
    return utxos[largestIndex]
}

/**
 * Get the transaction fee for a transaction.
 * @returns Transaction fee in Satoshis
 */
async function getBitcoinCashTransactionFee(senderAddress, satoshisToSend) {
    // Create a new BitBox instance
    const bitbox = new BITBOX;
    // Get utxos
    const u = await bitbox.Address.utxo(senderAddress);
    // Get biggest utxo
    const utxo = findBiggestUtxo(u.utxos);

    let byteCount;
    // Check if the biggest Utxo has less satoshis than the satoshis to send
    let outputs = 2;
    if (utxo.satoshis < satoshisToSend) {
        // Array to store all utxos
        const inputs = [];
        // Loop through each UTXO assigned to this address.
        u.utxos.forEach(utxo => {
            inputs.push(utxo)
        })
        // Get byte count to calculate fee. paying 1.0 sat/byte. Output is two because we are sending a transaction
        byteCount = getByteCount(inputs.length, outputs);
    } else {
        // Get byte count to calculate fee. Paying 1.0 sat/byte (2 output transactions)
        byteCount = getByteCount(1, outputs);
    }

    // Set how many satoshis per byte.
    const satoshisPerByte = 1.0;
    // Calculate transaction fee
    const txFee = Math.floor(satoshisPerByte * byteCount);
    console.log(`byteCount: ${byteCount}`);
    console.log(`txFee: ${txFee}`);

    return txFee;
}

/**
 * Get Byte count to calculate a transaction fee
 * @param inputs - Number of inputs in the transaction
 * @param outputs - Number of outputs in the transaction
 * @returns number
 */
function getByteCount(inputs, outputs) {
    // Create a new BitBox instance
    const bitbox = new BITBOX;
    return bitbox.BitcoinCash.getByteCount(
        { P2PKH: inputs },
        { P2PKH: outputs }
    )
}

