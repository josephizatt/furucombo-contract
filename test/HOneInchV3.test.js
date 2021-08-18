const {
  balance,
  BN,
  constants,
  ether,
  expectEvent,
  expectRevert,
  time,
} = require('@openzeppelin/test-helpers');
const { tracker } = balance;
const { MAX_UINT256 } = constants;
const { latest } = time;
const abi = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const utils = web3.utils;
const { expect } = require('chai');
const {
  DAI_TOKEN,
  DAI_PROVIDER,
  DAI_SYMBOL,
  USDC_TOKEN,
  USDC_SYMBOL,
} = require('./utils/constants');
const {
  evmRevert,
  evmSnapshot,
  mulPercent,
  profileGas,
  getHandlerReturn,
  getCallData,
} = require('./utils/utils');
const fetch = require('node-fetch');
const queryString = require('query-string');

const HOneInch = artifacts.require('HOneInchV3');
const Registry = artifacts.require('Registry');
const Proxy = artifacts.require('ProxyMock');
const IToken = artifacts.require('IERC20');

contract('OneInchV3 Swap', function([_, user]) {
  let id;

  before(async function() {
    this.registry = await Registry.new();
    this.hOneInch = await HOneInch.new();
    await this.registry.register(
      this.hOneInch.address,
      utils.asciiToHex('OneInchV3')
    );
    this.proxy = await Proxy.new(this.registry.address);
  });

  beforeEach(async function() {
    id = await evmSnapshot();
  });

  afterEach(async function() {
    await evmRevert(id);
  });

  describe('Ether to Token', function() {
    const tokenAddress = DAI_TOKEN;
    const tokenSymbol = DAI_SYMBOL;

    let balanceUser;
    let balanceProxy;
    let tokenUser;

    before(async function() {
      this.token = await IToken.at(tokenAddress);
    });

    beforeEach(async function() {
      balanceUser = await tracker(user);
      balanceProxy = await tracker(this.proxy.address);
      tokenUser = await this.token.balanceOf.call(user);
    });

    describe('Exact input', function() {
      it('normal', async function() {
        const value = ether('0.1');
        const to = this.hOneInch.address;
        const slippage = 3;

        const swapReq = queryString.stringifyUrl({
          url: 'https://api.1inch.exchange/v3.0/1/swap',
          query: {
            fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            toTokenAddress: tokenAddress,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            protocols: 'ONE_INCH_LP'
          },
        });

        const swapResponse = await fetch(swapReq);
        const swapData = await swapResponse.json();
        console.log(`swapData = ${JSON.stringify(swapData)}`);
        expect(swapData.tx.data.substring(0, 10)).to.be.eq('0x7c025200'); // verify it's `swap` function call
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        const tokenUserEnd = await this.token.balanceOf.call(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(tokenUserEnd.sub(tokenUser));

        expect(tokenUserEnd).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          tokenUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(
          await this.token.balanceOf.call(this.proxy.address)
        ).to.be.zero;
        expect(await balanceProxy.get()).to.be.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0')
            .sub(value)
            .sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });

      it('unoswap', async function() {
        const value = ether('0.1');
        const to = this.hOneInch.address;
        const slippage = 3;

        const swapReq = queryString.stringifyUrl({
          url: 'https://api.1inch.exchange/v3.0/1/swap',
          query: {
            fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            toTokenAddress: tokenAddress,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
            protocols: 'UNISWAP_V2'
          },
        });

        const swapResponse = await fetch(swapReq);
        const swapData = await swapResponse.json();
        console.log(`swapData = ${JSON.stringify(swapData)}`);
        // const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;
        /// reshape data
        expect(swapData.tx.data.substring(0, 10)).to.be.eq('0x2e95b6c8'); // verify it's `unoswap` function call
        const dataWithoutSelector = '0x' + swapData.tx.data.substring(10);
        const decoded = web3.eth.abi.decodeParameters(['address', 'uint256', 'uint256', 'bytes32[]'], dataWithoutSelector);
        const data = getCallData(HOneInch, 'unoswap', [decoded[0], decoded[1], decoded[2], decoded[3], swapData.toToken.address]);
        // const dstToken = utils.padLeft(swapData.tx.toToken.address, '64');
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value,
        });

        const tokenUserEnd = await this.token.balanceOf.call(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(tokenUserEnd.sub(tokenUser));

        expect(tokenUserEnd).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          tokenUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(
          await this.token.balanceOf.call(this.proxy.address)
        ).to.be.zero;
        expect(await balanceProxy.get()).to.be.zero;
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0')
            .sub(value)
            .sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });
return;
      it('msg.value greater than input ether amount', async function() {
        const value = ether('0.1');
        const to = this.hOneInch.address;
        const slippage = 3;

        const swapReq = queryString.stringifyUrl({
          url: 'https://api.1inch.exchange/v2.0/swap',
          query: {
            fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            toTokenAddress: tokenAddress,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
          },
        });

        const swapResponse = await fetch(swapReq);
        const swapData = await swapResponse.json();
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: value.add(ether('1')),
        });

        const tokenUserEnd = await this.token.balanceOf.call(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(tokenUserEnd.sub(tokenUser));

        expect(tokenUserEnd).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          tokenUser.add(mulPercent(quote, 100 - slippage - 1))
        );
        expect(
          await this.token.balanceOf.call(this.proxy.address)
        ).to.be.bignumber.eq(ether('0'));
        expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));
        expect(await balanceUser.delta()).to.be.bignumber.eq(
          ether('0')
            .sub(value)
            .sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });
    });
  });
return;
  describe('Token to Ether', function() {
    const tokenAddress = DAI_TOKEN;
    const tokenSymbol = DAI_SYMBOL;
    const providerAddress = DAI_PROVIDER;

    let balanceUser;
    let balanceProxy;
    let tokenUser;

    before(async function() {
      this.token = await IToken.at(tokenAddress);
    });

    beforeEach(async function() {
      balanceUser = await tracker(user);
      balanceProxy = await tracker(this.proxy.address);
      tokenUser = await this.token.balanceOf.call(user);
    });

    describe('Exact input', function() {
      it('normal', async function() {
        const value = ether('50');
        const to = this.hOneInch.address;
        const slippage = 3;

        const swapReq = queryString.stringifyUrl({
          url: 'https://api.1inch.exchange/v2.0/swap',
          query: {
            fromTokenAddress: tokenAddress,
            toTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
          },
        });

        await this.token.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token.address);

        const swapResponse = await fetch(swapReq);
        const swapData = await swapResponse.json();
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        const balanceUserDelta = await balanceUser.delta();

        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(
          balanceUserDelta.add(new BN(receipt.receipt.gasUsed))
        );

        expect(await this.token.balanceOf.call(user)).to.be.bignumber.eq(
          tokenUser
        );
        expect(
          await this.token.balanceOf.call(this.proxy.address)
        ).to.be.bignumber.eq(ether('0'));
        expect(await balanceProxy.get()).to.be.bignumber.eq(ether('0'));
        expect(balanceUserDelta).to.be.bignumber.gte(
          ether('0')
            // sub 1 more percent to tolerate the slippage calculation difference with 1inch
            .add(mulPercent(quote, 100 - slippage - 1))
            .sub(new BN(receipt.receipt.gasUsed))
        );

        profileGas(receipt);
      });
    });
  });

  describe('Token to Token', function() {
    const token0Address = DAI_TOKEN;
    const token0Symbol = DAI_SYMBOL;
    const token1Address = USDC_TOKEN;
    const token1Symbol = USDC_SYMBOL;
    const providerAddress = DAI_PROVIDER;

    let token0User;
    let token1User;

    before(async function() {
      this.token0 = await IToken.at(token0Address);
      this.token1 = await IToken.at(token1Address);
    });

    beforeEach(async function() {
      token0User = await this.token0.balanceOf.call(user);
      token1User = await this.token1.balanceOf.call(user);
    });

    describe('Exact input', function() {
      it('normal', async function() {
        const value = ether('50');
        const to = this.hOneInch.address;
        const slippage = 3;

        const swapReq = queryString.stringifyUrl({
          url: 'https://api.1inch.exchange/v2.0/swap',
          query: {
            fromTokenAddress: token0Address,
            toTokenAddress: token1Address,
            amount: value,
            slippage: slippage,
            disableEstimate: true,
            fromAddress: this.proxy.address,
          },
        });

        await this.token0.transfer(this.proxy.address, value, {
          from: providerAddress,
        });
        await this.proxy.updateTokenMock(this.token0.address);

        const swapResponse = await fetch(swapReq);
        const swapData = await swapResponse.json();
        const data = swapData.tx.data;
        const quote = swapData.toTokenAmount;
        const receipt = await this.proxy.execMock(to, data, {
          from: user,
          value: ether('0.1'),
        });

        const token1UserEnd = await this.token1.balanceOf.call(user);
        const handlerReturn = utils.toBN(
          getHandlerReturn(receipt, ['uint256'])[0]
        );
        expect(handlerReturn).to.be.bignumber.eq(token1UserEnd.sub(token1User));

        expect(await this.token0.balanceOf.call(user)).to.be.bignumber.eq(
          token0User
        );
        expect(
          await this.token0.balanceOf.call(this.proxy.address)
        ).to.be.bignumber.eq(ether('0'));
        expect(
          await this.token1.balanceOf.call(this.proxy.address)
        ).to.be.bignumber.eq(ether('0'));
        expect(await this.token1.balanceOf.call(user)).to.be.bignumber.gte(
          // sub 1 more percent to tolerate the slippage calculation difference with 1inch
          token1User.add(mulPercent(quote, 100 - slippage - 1))
        );

        profileGas(receipt);
      });
    });
  });
});
