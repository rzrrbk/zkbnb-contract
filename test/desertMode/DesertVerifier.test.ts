import { assert, chai } from 'chai';
import { ethers } from 'hardhat';
import * as poseidonContract from './poseidon_gencontract';
import { Scalar } from 'ffjavascript';
import { BigNumber } from 'ethers';

import { randomBN } from '../util';
import exitDataJson from './performDesertAsset2.json';
// import exitDataJson from './performDesertAsset222.json';
// import exitDataJson from './performDesertAsset333.json';
// import exitDataJson from './performDesertAsset444.json';
import exitNftJson from './performDesertNft.json';

import buildPoseidon from './poseidon_reference';

describe('DesertVerifier', function () {
  let owner, addr1;
  // poseidon wasm
  let poseidon;

  // poseidon contract with inputs uint256[2]
  let poseidonT3;
  // poseidon contract with inputs uint256[5]
  let poseidonT6;
  // poseidon contract with inputs uint256[6]
  let poseidonT7;
  // contract to verify exit proof
  let desertVerifier;

  let assetRoot;
  let accountLeafHash;
  let accountRoot;
  let nftRoot;

  before(async function () {
    [owner, addr1] = await ethers.getSigners();

    poseidon = await buildPoseidon();

    const PoseidonT3 = new ethers.ContractFactory(
      poseidonContract.generateABI(2),
      poseidonContract.createCode(2),
      owner,
    );
    poseidonT3 = await PoseidonT3.deploy();
    await poseidonT3.deployed();

    const PoseidonT6 = new ethers.ContractFactory(
      poseidonContract.generateABI(5),
      poseidonContract.createCode(5),
      owner,
    );
    poseidonT6 = await PoseidonT6.deploy();
    await poseidonT6.deployed();

    const PoseidonT7 = new ethers.ContractFactory(
      poseidonContract.generateABI(6),
      poseidonContract.createCode(6),
      owner,
    );
    poseidonT7 = await PoseidonT7.deploy();
    await poseidonT7.deployed();

    const DesertVerifier = await ethers.getContractFactory('DesertVerifierTest');
    desertVerifier = await DesertVerifier.deploy(poseidonT3.address, poseidonT6.address, poseidonT7.address);
    await desertVerifier.deployed();
  });

  it.skip('test hash [1,2] and [2,1]', async () => {
    const inputs = [1, 2];
    const actual = poseidon(inputs);
    const expect = '7142104613055408817911962100316808866448378443474503659992478482890339429929';
    assert.equal(poseidon.F.toString(actual), expect);

    console.log('[1,2] hash is : ', BigNumber.from(expect).toHexString());
    const res = poseidon.F.toString([2, 1]);
    console.log('[2,1] hash is : ', BigNumber.from(res).toHexString());
  });

  it.skip('(poseidonReference) should hash asset leaf node correctly', async () => {
    const inputs = [
      exitDataJson.AssetExitData.Amount.toString(),
      exitDataJson.AssetExitData.OfferCanceledOrFinalized.toString(),
    ];
    const actual = await poseidon(inputs);
    const expect = '15177058551175628990872411207427175536618395970821712272889300877778671208350';

    assert.equal(poseidon.F.toString(actual), expect);

    console.log('asset leaf is : ', BigNumber.from(expect).toHexString());
  });

  it('should hash asset leaf node correctly', async () => {
    const inputs = [
      exitDataJson.AssetExitData.Amount.toString(),
      exitDataJson.AssetExitData.OfferCanceledOrFinalized.toString(),
    ];
    const actual = await poseidonT3['poseidon(uint256[2])'](inputs);
    const reference = poseidon(inputs);
    const expect = '218de925460d1e5cf0a26c27124e23a380ec0e2d30518b5d108005bc02c5879e'; // taken from L2's log

    assert.equal(actual.toString(), poseidon.F.toString(reference));
    assert.equal(actual.toHexString(), '0x' + expect);
  });

  it('check asset tree root node', async () => {
    assetRoot = await desertVerifier.testGetAssetRoot(
      exitDataJson.AssetExitData.AssetId,
      BigNumber.from(exitDataJson.AssetExitData.Amount.toString()),
      exitDataJson.AssetExitData.OfferCanceledOrFinalized,
      exitDataJson.AssetMerkleProof.map((el: string) => BigNumber.from('0x' + el)),
    );

    const expectAssetRoot = '11d6f9a8ef166dd57b9809e47c679658b8eb3c5d237f912acce178342ce07d49'; // taken from L2's log

    assert.equal(assetRoot.toHexString(), '0x' + expectAssetRoot);
    console.log('asset root: ', assetRoot.toHexString());
  });

  it('check account leaf hash', async () => {
    const inputs = [
      exitDataJson.AccountExitData.L1Address,
      // BigNumber.from(exitDataJson.AccountExitData.L1Address),
      exitDataJson.AccountExitData.PubKeyX,
      exitDataJson.AccountExitData.PubKeyY,
      // BigNumber.from(exitDataJson.AccountExitData.PubKeyX),
      // BigNumber.from(exitDataJson.AccountExitData.PubKeyY),
      exitDataJson.AccountExitData.Nonce,
      exitDataJson.AccountExitData.CollectionNonce,
      assetRoot,
    ];

    const actual = await poseidonT7['poseidon(uint256[6])'](inputs);
    const expect = poseidon(inputs);
    assert.equal(actual.toString(), poseidon.F.toString(expect));

    const expectLog = '0x8d177d83a2bcfc59091b802531712ae222bb78b586ac1a5099b02d92104b84';
    assert.equal(actual.toHexString(), expectLog);
    console.log('account Leaf: ', actual.toHexString());
    accountLeafHash = actual;
  });

  it('check account root', async () => {
    accountRoot = await desertVerifier.testGetAccountRoot(
      exitDataJson.AccountExitData.AccountId,
      exitDataJson.AccountExitData.L1Address,
      exitDataJson.AccountExitData.PubKeyX,
      exitDataJson.AccountExitData.PubKeyY,
      exitDataJson.AccountExitData.Nonce,
      exitDataJson.AccountExitData.CollectionNonce,
      assetRoot,
      exitDataJson.AccountMerkleProof.map((el: string) => BigNumber.from('0x' + el)),
    );

    const expectAccountRoot = '2a754f8b0b683bd08de6425b8b36be15a7f29d32bb4ee37873e43a5721b3d32c';
    assert.equal(accountRoot.toHexString(), '0x' + expectAccountRoot);
    console.log('account root:', accountRoot.toHexString());
  });

  it('check state hash', async () => {
    const inputs = [accountRoot, '0x' + exitDataJson.NftRoot];
    const stateHash = await poseidonT3['poseidon(uint256[2])'](inputs);
    const expectStateHash = '24f44b2a9149d4c5618369b5b4f4214f081330907c0f7deaa4d68f8e670bbe75';

    assert.equal(stateHash.toHexString(), '0x' + expectStateHash);
    console.log('state hash: ', stateHash.toHexString());
  });

  it.skip('check nft leaf node', async () => {
    for (const nft of exitNftJson.ExitNfts) {
      const inputs = [
        nft.CreatorAccountIndex,
        nft.OwnerAccountIndex,
        BigNumber.from('0x' + nft.NftContentHash),
        nft.CreatorTreasuryRate,
        nft.NftContentType,
      ];
      const actual = await poseidonT6['poseidon(uint256[5])'](inputs);
      const expect = poseidon(inputs);
      assert.equal(actual.toString(), poseidon.F.toString(expect));
    }
  });

  it.skip('check nft root', async () => {
    for (const [i, nft] of exitNftJson.ExitNfts.entries()) {
      const nftMerkleProof = exitNftJson.NftMerkleProofs[i];

      nftRoot = await desertVerifier.testGetNftRoot(
        nft.NftIndex,
        nft.CreatorAccountIndex,
        nft.OwnerAccountIndex,
        BigNumber.from('0x' + nft.NftContentHash),
        nft.CreatorTreasuryRate,
        nft.CollectionId,
        nft.NftContentType,
        nftMerkleProof.map((el: string) => BigNumber.from('0x' + el)),
      );

      console.log('done. nft root is: ', nftRoot.toHexString());
    }
  });

  it.skip('desert proof verification should pass', async () => {
    const _stateRoot = poseidon([accountSMT.root, nftSMT.root]);
    const stateRoot = BigNumber.from(_stateRoot);

    console.log('stateRoot: ', stateRoot);
    const assetProof = await accountAssetSMT.find(exitData.assetId);
    const accountProof = await accountSMT.find(exitData.accountId);
    const nftProof = await nftSMT.find(exitData.nftIndex);

    console.log(assetProof.siblings);
    console.log(accountProof.siblings);
    console.log(nftProof.siblings);

    const assetMerkleProof = toProofParam(assetProof.siblings, 15);
    const accountMerkleProof = toProofParam(accountProof, 31);
    const nftMerkleProof = toProofParam(nftProof, 39);

    const res = await desertVerifier.verifyExitProof(
      stateRoot,
      [0, 2, 0, 100, 1, randomBN(), randomBN(), randomBN(), 1, 1, 1, 2, randomBN(), 5, 1],
      assetMerkleProof,
      accountMerkleProof,
      nftMerkleProof,
    );

    // assert(res);
    console.log('done verifyExitProof: ', res);
  });
});
