
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
    // Convert to public key
    const pubKey = bitbox.HDNode.toPublicKey(hdNode);
    // Convert to private key
    const privKey = bitbox.HDNode.toWif(hdNode);

    return { pubKey, privKey };

    /*
    const cashAddr = bitbox.HDNode.toCashAddress(hdNode);
    // to wif
    const wifKey = bitbox.HDNode.toWIF(hdNode);
    // Encrypt wif key
    //const hashedWif = encrypt(wifKey);
    */

    /*
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
    }*/
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
