// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "./interfaces/IBaseRegistrar.sol";
import "./interfaces/IPriceOracle.sol";
import "./interfaces/IZNS.sol";
import "./lib/Names.sol";

/**
 * ZNSController is a registrar allocating subdomain names to users in ZkBNB in a FIFS way.
 */
contract ZNSController is IBaseRegistrar, OwnableUpgradeable, ReentrancyGuardUpgradeable {
  using Names for string;

  // ZNS registry
  IZNS public zns;

  // Price Oracle
  IPriceOracle public prices;

  // The nodehash/namehash of the root node this registrar owns (eg, .legend)
  bytes32 public baseNode;

  // A map of addresses that are authorized to control the registrar(eg, register names)
  mapping(address => bool) public controllers;

  // A map to record the L2 owner of each node. A L2 owner can own only 1 name.
  // pubKey => nodeHash
  mapping(bytes32 => bytes32) ZNSPubKeyMapper;

  // The minimum account name length allowed to register
  uint public minAccountNameLengthAllowed = 1;

  // True if the registration is paused
  bool public isPaused;

  uint256 immutable q = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

  event RegistrationPaused();
  event RegistrationResumed();
  event Withdraw(address _to, uint256 _value);
  event AccountNameLengthThresholdChanged(uint newMinLengthAllowed);

  modifier onlyController() {
    require(controllers[msg.sender]);
    _;
  }

  modifier live() {
    require(zns.owner(baseNode) == address(this), "zns not assigned");
    require(!isPaused, "paused");
    _;
  }

  function initialize(bytes calldata initializationParameters) external initializer {
    __Ownable_init();
    __ReentrancyGuard_init();

    (address _znsAddr, address _prices, bytes32 _node) = abi.decode(
      initializationParameters,
      (address, address, bytes32)
    );
    zns = IZNS(_znsAddr);
    prices = IPriceOracle(_prices);
    baseNode = bytes32(uint256(_node) % q);

    // initialize ownership
    controllers[msg.sender] = true;
  }

  /**
   /* * @dev Register a new node under base node if it not exists. */
  /* * @param _name The plaintext of the name to register */
  /* * @param _owner The address to receive this name */
  /* * @param _pubKeyX The pub key x of the owner */
  /* * @param _pubKeyY The pub key y of the owner */
  //*/
  function registerZNS(
    bytes32 nameHash,
    /* address _owner, */
    uint32 accountIndex,
    bytes32 _pubKeyX,
    bytes32 _pubKeyY,
    address _resolver
  ) public {
    // Check if this name is valid
    ///    require(_valid(_name), "invalid name");
    // This L2 owner should not own any name before
    //    /* require(_validPubKey(_pubKeyY), "pub key existed"); */
    /* // Calculate price using PriceOracle */
    /* uint256 price = prices.price(_name); */
    /* // Check enough value */
    /* require(msg.value >= price, "nev"); */

    // Get the name hash - 改从入参传入
    /* bytes32 label = keccak256Hash(bytes(_name)); */
    // This subnode should not be registered before
    ////    require(!zns.subNodeRecordExists(baseNode, label), "subnode existed");
    // Register subnode
    zns.setSubnodeRecord(
      /* baseNode, */
      nameHash,
      accountIndex,
      /* _owner, */
      _pubKeyX,
      _pubKeyY,
      _resolver
    );

    // Update L2 owner mapper
    ZNSPubKeyMapper[_pubKeyY] = nameHash;

    /* emit ZNSRegistered(_name, subnode, accountIndex, _owner, _pubKeyX, _pubKeyY, price); */

    /* // Refund remained value to the owner of this name */
    /* if (msg.value > price) { */
    /*   payable(_owner).transfer(msg.value - price); */
    /* } */
  }

  /// @notice ZNSController contract upgrade. Can be external because Proxy contract intercepts illegal calls of this function.
  /// @param upgradeParameters Encoded representation of upgrade parameters
  // solhint-disable-next-line no-empty-blocks
  function upgrade(bytes calldata upgradeParameters) external {}

  // Authorizes a controller, who can control this registrar.
  function addController(address _controller) external override onlyOwner {
    controllers[_controller] = true;
    emit ControllerAdded(_controller);
  }

  // Revoke controller permission for an address.
  function removeController(address _controller) external override onlyOwner {
    controllers[_controller] = false;
    emit ControllerRemoved(_controller);
  }

  // Set resolver for the node this registrar manages.
  // This msg.sender must be the owner of base node.
  function setThisResolver(address _resolver) external override onlyOwner {
    zns.setResolver(baseNode, _resolver);
  }

  /**
   * @dev Withdraw BNB from this contract, only called by the owner of this contract.
   * @param _to The address to receive
   * @param _value The BNB amount to withdraw
   */
  function withdraw(address _to, uint256 _value) external onlyOwner nonReentrant {
    // Check not too much value
    require(_value <= address(this).balance, "tmv");
    // Withdraw
    payable(_to).call{value: _value}("");

    emit Withdraw(_to, _value);
  }

  /**
   * @dev Pause the registration through this controller
   */
  function pauseRegistration() external override onlyOwner {
    if (!isPaused) {
      isPaused = true;
    }
  }

  /**
   * @dev Resume registration
   */
  function unPauseRegistration() external override onlyOwner {
    if (isPaused) {
      isPaused = false;
    }
  }

  /**
   * @dev Set the minimum account name length allowed to register
   */
  function setAccountNameLengthThreshold(uint newMinLengthAllowed) external override onlyOwner {
    if (newMinLengthAllowed != minAccountNameLengthAllowed) {
      minAccountNameLengthAllowed = newMinLengthAllowed;
      emit AccountNameLengthThresholdChanged(newMinLengthAllowed);
    }
  }

  function getOwner(bytes32 node) external view returns (address) {
    return zns.owner(node);
  }

  function getSubnodeNameHash(string memory name) external view returns (bytes32) {
    bytes32 subnode = keccak256Hash(abi.encodePacked(baseNode, keccak256Hash(bytes(name))));
    subnode = bytes32(uint256(subnode) % q);
    return subnode;
  }

  function isRegisteredNameHash(bytes32 _nameHash) external view returns (bool) {
    return zns.recordExists(_nameHash);
  }

  function isRegisteredZNSName(string memory _name) external view returns (bool) {
    bytes32 subnode = this.getSubnodeNameHash(_name);
    return this.isRegisteredNameHash(subnode);
  }

  function getZNSNamePrice(string calldata name) external view returns (uint256) {
    return prices.price(name);
  }

  function keccak256Hash(bytes memory input) public pure returns (bytes32 result) {
    result = keccak256(input);
  }

  function _valid(string memory _name) internal view returns (bool) {
    return _validCharset(_name) && _validLength(_name);
  }

  function _validLength(string memory _name) internal view returns (bool) {
    return _name.strlen() >= minAccountNameLengthAllowed && _name.strlen() <= 20;
  }

  function _validPubKey(bytes32 _pubKey) internal view returns (bool) {
    return ZNSPubKeyMapper[_pubKey] == 0x0;
  }

  function _validCharset(string memory _name) internal pure returns (bool) {
    return _name.charsetValid();
  }
}
