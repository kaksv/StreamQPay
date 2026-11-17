// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StreamPay} from "../src/StreamPay.sol";
import {MockERC20} from "./MockERC20.sol";

interface Vm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
}

contract StreamPayTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant RECIPIENT = address(0xBEEF);
    address private constant OTHER = address(0xCAFE);
    uint64 private constant DURATION = 100;

    MockERC20 private token;
    StreamPay private streamPay;

    function setUp() public {
        token = new MockERC20();
        streamPay = new StreamPay(IERC20(address(token)));
        token.mint(address(this), 10_000_000);
        token.approve(address(streamPay), type(uint256).max);
    }

    function test_CreateStream() public {
        uint256 id = _create(RECIPIENT, 1_000_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        _eq(stream.sender, address(this));
        _eq(stream.recipient, RECIPIENT);
        _eq(stream.deposit, 1_000_000);
        _eq(stream.endTime - stream.startTime, DURATION);
        _true(stream.cancellable);
        _eq(token.balanceOf(address(streamPay)), 1_000_000);
    }

    function test_RevertInvalidRecipient() public {
        vm.expectRevert(StreamPay.InvalidRecipient.selector);
        streamPay.createStream(address(0), 1, DURATION, true);
    }

    function test_RevertZeroDeposit() public {
        vm.expectRevert(StreamPay.ZeroAmount.selector);
        streamPay.createStream(RECIPIENT, 0, DURATION, true);
    }

    function test_RevertZeroDuration() public {
        vm.expectRevert(StreamPay.InvalidDuration.selector);
        streamPay.createStream(RECIPIENT, 1, 0, true);
    }

    function test_RevertInsufficientAllowance() public {
        token.approve(address(streamPay), 0);
        vm.expectRevert();
        streamPay.createStream(RECIPIENT, 1, DURATION, true);
    }

    function test_RevertInsufficientBalance() public {
        vm.expectRevert();
        streamPay.createStream(RECIPIENT, 10_000_001, DURATION, true);
    }

    function test_AccrualBeforeAndAtStart() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime - 1);
        _eq(streamPay.accruedAmount(id), 0);
        vm.warp(stream.startTime);
        _eq(streamPay.accruedAmount(id), 0);
    }

    function test_AccrualAfterOneSecond() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + 1);
        _eq(streamPay.accruedAmount(id), 10);
    }

    function test_AccrualHalfwayAndAtCompletion() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + DURATION / 2);
        _eq(streamPay.accruedAmount(id), 500);
        vm.warp(stream.endTime);
        _eq(streamPay.accruedAmount(id), 1_000);
        vm.warp(stream.endTime + 1);
        _eq(streamPay.accruedAmount(id), 1_000);
    }

    function test_PartialAndMultipleWithdrawals() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + 50);
        vm.prank(RECIPIENT);
        streamPay.withdrawFromStream(id, 200);
        vm.prank(RECIPIENT);
        streamPay.withdrawFromStream(id, 300);
        _eq(streamPay.withdrawableAmount(id), 0);
        _eq(token.balanceOf(RECIPIENT), 500);
    }

    function test_FullWithdrawal() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, false);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.endTime);
        vm.prank(RECIPIENT);
        streamPay.withdrawFromStream(id, 1_000);
        _eq(token.balanceOf(RECIPIENT), 1_000);
        _eq(streamPay.withdrawableAmount(id), 0);
    }

    function test_RevertUnauthorizedWithdrawal() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, false);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + 50);
        vm.expectRevert(StreamPay.Unauthorized.selector);
        streamPay.withdrawFromStream(id, 1);
    }

    function test_RevertWithdrawalAboveAccrued() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, false);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + 50);
        vm.prank(RECIPIENT);
        vm.expectRevert(StreamPay.InvalidWithdrawalAmount.selector);
        streamPay.withdrawFromStream(id, 501);
    }

    function test_CancelRefundsUnaccruedAmount() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + 40);
        uint256 balanceBefore = token.balanceOf(address(this));
        streamPay.cancelStream(id);
        _eq(token.balanceOf(address(this)) - balanceBefore, 600);
        _eq(streamPay.accruedAmount(id), 400);
        _eq(streamPay.withdrawableAmount(id), 400);
    }

    function test_RevertUnauthorizedCancellation() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + 40);
        vm.prank(OTHER);
        vm.expectRevert(StreamPay.Unauthorized.selector);
        streamPay.cancelStream(id);
    }

    function test_CancelAfterPartialWithdrawal() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + 40);
        vm.prank(RECIPIENT);
        streamPay.withdrawFromStream(id, 100);
        uint256 balanceBefore = token.balanceOf(address(this));
        streamPay.cancelStream(id);
        _eq(token.balanceOf(address(this)) - balanceBefore, 600);
        _eq(streamPay.withdrawableAmount(id), 300);
        _eq(token.balanceOf(address(streamPay)), 300);
    }

    function test_RecipientWithdrawsAfterCancellation() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + 40);
        streamPay.cancelStream(id);
        vm.warp(stream.endTime + 50);
        vm.prank(RECIPIENT);
        streamPay.withdrawFromStream(id, 400);
        _eq(token.balanceOf(RECIPIENT), 400);
    }

    function test_RevertDoubleCancellation() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + 40);
        streamPay.cancelStream(id);
        vm.expectRevert(StreamPay.AlreadyCancelled.selector);
        streamPay.cancelStream(id);
    }

    function test_RevertNonCancellableStream() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, false);
        vm.expectRevert(StreamPay.NotCancellable.selector);
        streamPay.cancelStream(id);
    }

    function test_RevertCancelAfterCompletion() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.endTime);
        vm.expectRevert(StreamPay.StreamEnded.selector);
        streamPay.cancelStream(id);
    }

    function test_MultipleStreamsRemainIndependent() public {
        uint256 first = _create(RECIPIENT, 1_000, DURATION, true);
        uint256 second = _create(OTHER, 2_000, DURATION * 2, true);
        StreamPay.Stream memory firstStream = streamPay.getStream(first);
        vm.warp(firstStream.startTime + DURATION);
        _eq(streamPay.accruedAmount(first), 1_000);
        _eq(streamPay.accruedAmount(second), 1_000);
        _eq(token.balanceOf(address(streamPay)), 3_000);
    }

    function test_SmallAmountRoundingCompletesExactly() public {
        uint256 id = _create(RECIPIENT, 1, DURATION, false);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + DURATION / 2);
        _eq(streamPay.accruedAmount(id), 0);
        vm.warp(stream.endTime);
        _eq(streamPay.accruedAmount(id), 1);
    }

    function test_FailedTokenTransferLeavesAccountingUnchanged() public {
        uint256 id = _create(RECIPIENT, 1_000, DURATION, false);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.endTime);
        token.setFailTransfers(true);
        vm.prank(RECIPIENT);
        vm.expectRevert();
        streamPay.withdrawFromStream(id, 1_000);
        _eq(streamPay.withdrawableAmount(id), 1_000);
    }

    function test_ReentrancyAttemptIsBlocked() public {
        token.setCallback(address(streamPay), abi.encodeCall(StreamPay.createStream, (OTHER, 1, DURATION, true)));
        _create(RECIPIENT, 1_000, DURATION, true);
        _true(token.reentryBlocked());
        _eq(streamPay.nextStreamId(), 2);
    }

    function testFuzz_AccruedNeverExceedsDeposit(uint96 amountSeed, uint64 elapsedSeed) public {
        uint256 amount = uint256(amountSeed) + 1;
        uint64 duration = 1_000;
        token.mint(address(this), amount);
        uint256 id = _create(RECIPIENT, amount, duration, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        vm.warp(stream.startTime + uint256(elapsedSeed) % (uint256(duration) + 1));
        uint256 accrued = streamPay.accruedAmount(id);
        _true(accrued <= amount);
        vm.warp(stream.endTime);
        _eq(streamPay.accruedAmount(id), amount);
    }

    function testFuzz_CancelRefundAndEarnedSumEqualsDeposit(uint96 amountSeed, uint64 elapsedSeed) public {
        uint256 amount = uint256(amountSeed) + 1;
        uint64 duration = 1_000;
        token.mint(address(this), amount);
        uint256 id = _create(RECIPIENT, amount, duration, true);
        StreamPay.Stream memory stream = streamPay.getStream(id);
        uint256 elapsed = uint256(elapsedSeed) % uint256(duration);
        vm.warp(stream.startTime + elapsed);
        uint256 earned = streamPay.accruedAmount(id);
        uint256 senderBefore = token.balanceOf(address(this));
        streamPay.cancelStream(id);
        uint256 refund = token.balanceOf(address(this)) - senderBefore;
        _eq(earned + refund, amount);
        _eq(streamPay.accruedAmount(id), earned);
    }

    function _create(address recipient, uint256 amount, uint64 duration, bool cancellable) private returns (uint256) {
        return streamPay.createStream(recipient, amount, duration, cancellable);
    }

    function _eq(uint256 actual, uint256 expected) private pure {
        require(actual == expected, "uint mismatch");
    }

    function _eq(address actual, address expected) private pure {
        require(actual == expected, "address mismatch");
    }

    function _true(bool condition) private pure {
        require(condition, "expected true");
    }
}
